#!/usr/bin/env node
// Sealgate MCP server: a thin stdio wrapper that exposes the existing CLI
// (cli/sealgate.mjs) as MCP tools. No protocol logic lives here; every tool
// spawns `node cli/sealgate.mjs <command> ...` with the repo root as cwd.
// Usage: node mcp/server.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod'; // installed as a dependency of the MCP SDK

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(REPO_ROOT, 'cli', 'sealgate.mjs');
const TIMEOUT_MS = 10 * 60 * 1000; // AI steps (inspect/appeal) can be slow

// Run the CLI and collect interleaved stdout+stderr. Never rejects on a
// non-zero exit; the caller decides what counts as an error.
function runCli(args, envExtra = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => {
      output += `\n[sealgate-mcp] CLI timed out after ${TIMEOUT_MS / 1000}s; killed`;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ code: -1, output: `${output}\n[sealgate-mcp] failed to spawn CLI: ${err.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? (signal ? 128 : -1), output });
    });
  });
}

// Acceptance-policy merge (diff review R1): per-call policy arguments may
// only TIGHTEN the server's env policy, never loosen it — max-type bounds
// take the min of (env, arg), min-type bounds take the max. The env policy
// is the operator's floor against an agent accepting terms unread.
function tightenPolicyEnv(extra) {
  const out = {};
  for (const k of ['SEALGATE_MAX_FEE_BPS']) {
    const env = process.env[k] !== undefined ? Number(process.env[k]) : undefined;
    const arg = extra[k] !== undefined ? Number(extra[k]) : undefined;
    const v = env !== undefined && arg !== undefined ? Math.min(env, arg) : (arg ?? env);
    if (v !== undefined) out[k] = String(v);
  }
  for (const k of ['SEALGATE_MIN_W_MS', 'SEALGATE_MIN_W1_MS', 'SEALGATE_MIN_DELIVER_MS']) {
    const env = process.env[k] !== undefined ? Number(process.env[k]) : undefined;
    const arg = extra[k] !== undefined ? Number(extra[k]) : undefined;
    const v = env !== undefined && arg !== undefined ? Math.max(env, arg) : (arg ?? env);
    if (v !== undefined) out[k] = String(v);
  }
  const envB = process.env.SEALGATE_MAX_BOND_NEAR;
  const argB = extra.SEALGATE_MAX_BOND_NEAR;
  if (envB !== undefined && argB !== undefined) out.SEALGATE_MAX_BOND_NEAR = Number(envB) <= Number(argB) ? envB : argB;
  else if (argB !== undefined) out.SEALGATE_MAX_BOND_NEAR = argB;
  return out;
}

const policyArgsSchema = {
  maxFeeBps: z.number().int().nonnegative().optional().describe('Acceptance policy: refuse if the fee exceeds this (basis points). Can only tighten the server env policy.'),
  minWMin: z.number().positive().optional().describe('Acceptance policy: refuse if the dispute window is shorter than this (minutes). Can only tighten the server env policy.'),
  minW1Min: z.number().positive().optional().describe('Acceptance policy: refuse if the appeal window is shorter than this (minutes). Can only tighten the server env policy.'),
  maxBondNear: z.string().regex(/^\d+(\.\d+)?$/).optional().describe('Acceptance policy: refuse if B0 exceeds this (NEAR decimal). Can only tighten the server env policy.'),
  minDeliverHours: z.number().positive().optional().describe('Acceptance policy: refuse if the deliver window (or time left to deliver) is shorter than this (hours). Can only tighten the server env policy.'),
};

const policyEnvFrom = ({ maxFeeBps, minWMin, minW1Min, maxBondNear, minDeliverHours }) => tightenPolicyEnv({
  ...(maxFeeBps !== undefined ? { SEALGATE_MAX_FEE_BPS: String(maxFeeBps) } : {}),
  ...(minWMin !== undefined ? { SEALGATE_MIN_W_MS: String(Math.round(minWMin * 60000)) } : {}),
  ...(minW1Min !== undefined ? { SEALGATE_MIN_W1_MS: String(Math.round(minW1Min * 60000)) } : {}),
  ...(maxBondNear !== undefined ? { SEALGATE_MAX_BOND_NEAR: maxBondNear } : {}),
  ...(minDeliverHours !== undefined ? { SEALGATE_MIN_DELIVER_MS: String(Math.round(minDeliverHours * 3600000)) } : {}),
});

// Write tool-provided text into a private temp dir, run fn(path), always clean up.
async function withTempFile(name, content, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'sealgate-mcp-'));
  try {
    const file = join(dir, name);
    await writeFile(file, content, { mode: 0o600 });
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const text = (s) => [{ type: 'text', text: s.trimEnd() || '(no output)' }];

// Default exit-code rule: any non-zero exit is a tool error carrying the output.
function toResult({ code, output }, isError = (c) => c !== 0) {
  if (isError(code)) {
    return { content: text(`sealgate CLI exited with code ${code}\n${output}`), isError: true };
  }
  return { content: text(output) };
}

const cli = async (args, isError, envExtra) => toResult(await runCli(args, envExtra), isError);

// ---- argument schemas ----
const escrowId = z.number().int().nonnegative().describe('On-chain escrow id (integer)');
const party = z.enum(['buyer', 'worker']).describe('Which demo party acts: "buyer" or "worker"');

// ---- description fragments ----
const KEYS_NOTE =
  'Acts on the Sealgate demo testnet accounts (buyer/worker) using local key files under .keys/ ' +
  '(gitignored, never committed). Contract defaults to SEALGATE_CONTRACT or app2.sealgate-ghost.testnet.';
const READ_ONLY = 'READ-ONLY: no transaction is signed, no funds move.';
const MOVES_FUNDS = 'MOVES TESTNET FUNDS: signs a NEAR testnet transaction that attaches/locks/releases NEAR.';
const POSTS_CLAIM = 'POSTS AN ON-CHAIN CLAIM and attaches a bond (moves testnet funds).';
const SIGNS_TX = 'SIGNS A TESTNET TRANSACTION (gas only; no escrow funds move).';

const server = new McpServer({ name: 'sealgate', version: '1.0.0' });

function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description: `${description} ${KEYS_NOTE}`, inputSchema }, handler);
}

tool('sealgate_show',
  `Show an escrow's on-chain state (phase, claims, dispute) and both parties' internal balances. ${READ_ONLY}`,
  { escrowId },
  ({ escrowId }) => cli(['show', String(escrowId)]));

tool('sealgate_verify',
  `Re-check the integrity of the latest claim on an escrow against the local off-chain record (records/<id>.json) and the on-chain signer registry. Prints "integrity failures: [...]"; an empty list means the claim checks out. ${READ_ONLY}`,
  { escrowId },
  ({ escrowId }) => cli(['verify', String(escrowId)]));

tool('sealgate_receipt',
  `Export a portable claim receipt to receipts/<id>.receipt.json (repo-relative). Reads chain state; writes only that local file. ${READ_ONLY}`,
  { escrowId },
  ({ escrowId }) => cli(['receipt', String(escrowId)]));

tool('sealgate_verify_receipt',
  `Verify a receipt file offline (no chain or network access). Returns VERIFIED or NOT VERIFIED plus any failures; NOT VERIFIED is a normal result, not an error. Relative paths resolve against the repo root (e.g. "receipts/2.receipt.json"). ${READ_ONLY}`,
  { path: z.string().min(1).describe('Path to a .receipt.json file (absolute, or relative to the repo root)') },
  // The CLI exits 1 for NOT VERIFIED; only exit codes > 1 (or spawn failures) are errors.
  ({ path }) => cli(['verify-receipt', path], (c) => c > 1 || c < 0));

const termsArgsSchema = {
  caseType: z.enum(['inspection', 'adjudication']).optional().describe('Case type, fixed on-chain at creation (default inspection)'),
  bondBps: z.number().int().min(100).max(2500).optional().describe('Terms: bond rate in basis points (100-2500; default 1000 = 10%)'),
  bondFloorNear: z.string().regex(/^\d+(\.\d+)?$/).optional().describe('Terms: bond floor in NEAR (default 0.05, capped at 25% of the amount)'),
  wHours: z.number().positive().optional().describe('Terms: dispute window W in hours (default 1, minimum 1)'),
  w1Min: z.number().positive().optional().describe('Terms: appeal window W1 in minutes (default 30; must fit the executor declared range)'),
  maxFeeBps: z.number().int().nonnegative().optional().describe('Refuse creation if the platform fee schedule exceeds this (basis points); default pins the schedule as read'),
};

const termsFlagsFrom = ({ caseType, bondBps, bondFloorNear, wHours, w1Min, maxFeeBps }) => [
  ...(bondBps !== undefined ? ['--bond-bps', String(bondBps)] : []),
  ...(bondFloorNear !== undefined ? ['--bond-floor', bondFloorNear] : []),
  ...(wHours !== undefined ? ['--w-hours', String(wHours)] : []),
  ...(w1Min !== undefined ? ['--w1-min', String(w1Min)] : []),
  ...(maxFeeBps !== undefined ? ['--max-fee-bps', String(maxFeeBps)] : []),
];

tool('sealgate_create',
  `Create a new escrow as the buyer for the worker, committing the SHA-256 of the criteria on-chain; plaintext criteria are stored only in records/<id>.json. Accepts the v4 terms arguments (case type, bond rate/floor, windows) inside the constitutional bounds. Output includes the new escrow id. ${MOVES_FUNDS}`,
  {
    criteria: z.string().min(1).describe('Acceptance criteria (plain text)'),
    amountNear: z.string().regex(/^\d+(\.\d+)?$/).describe('Escrow amount in NEAR, as a decimal string, e.g. "1" or "0.5"'),
    ...termsArgsSchema,
  },
  ({ criteria, amountNear, caseType, ...terms }) =>
    withTempFile('criteria.txt', criteria, (f) => cli(['create', f, amountNear, ...(caseType ? [caseType] : []), ...termsFlagsFrom(terms)])));

tool('sealgate_create_open',
  `Post an OPEN JOB (bounty) as the buyer: an escrow with no worker yet; anyone may claim it. Commits the salted SHA-256 of the criteria on-chain and registers the buyer's response key (required before claiming). The output prints the salt: publishing the criteria text + salt off-chain is how the job is advertised. ${MOVES_FUNDS}`,
  {
    criteria: z.string().min(1).describe('Job criteria / case file (plain text)'),
    amountNear: z.string().regex(/^\d+(\.\d+)?$/).describe('Escrow amount in NEAR, e.g. "0.5"'),
    claimHours: z.number().positive().describe('Hours during which the job may be claimed'),
    deliverHours: z.number().positive().describe('Hours to deliver, counted from the claim'),
    settleHours: z.number().positive().describe('Settlement window after delivery (must cover the dispute + appeal windows; use >= 2)'),
    caseType: z.enum(['inspection', 'adjudication']).optional().describe('Case type fixed on-chain at creation (default inspection)'),
    bondBps: termsArgsSchema.bondBps, bondFloorNear: termsArgsSchema.bondFloorNear,
    wHours: termsArgsSchema.wHours, w1Min: termsArgsSchema.w1Min, maxFeeBps: termsArgsSchema.maxFeeBps,
  },
  ({ criteria, amountNear, claimHours, deliverHours, settleHours, caseType, ...terms }) =>
    withTempFile('criteria.txt', criteria, (f) => cli(['create-open', f, amountNear, String(claimHours), String(deliverHours), String(settleHours), ...(caseType ? [caseType] : []), ...termsFlagsFrom(terms)])));

tool('sealgate_open_jobs',
  `List the currently open (unclaimed) jobs with their full terms: fee and net-on-PASS, B0, dispute/appeal windows, appeal fee, terms hash. Read this BEFORE claiming — acceptance policy arguments on sealgate_claim_job enforce the bounds. ${READ_ONLY}`,
  {},
  () => cli(['open-jobs']));

tool('sealgate_claim_job',
  `Claim an open job as the worker. The published criteria (and the published salt, for salted jobs) are verified against the on-chain commitment BEFORE the claim transaction is sent (bait-and-switch protection). The job's terms are printed and checked against the acceptance policy: the server's SEALGATE_* env policy is a floor — per-call policy arguments can only tighten it, never loosen it. ${SIGNS_TX}`,
  {
    escrowId,
    criteria: z.string().min(1).describe('The published criteria text, exactly as advertised'),
    salt: z.string().optional().describe('The published commitment salt (hex), if the job is salted'),
    ...policyArgsSchema,
  },
  ({ escrowId, criteria, salt, ...pol }) =>
    withTempFile('criteria.txt', criteria, (f) => cli(['claim-job', String(escrowId), f, ...(salt ? [salt] : [])], undefined, policyEnvFrom(pol))));

tool('sealgate_register_keys',
  `Register both demo parties' X25519 public keys for an escrow (needed before claims can be encrypted). For the worker this is the engagement-acceptance point on a closed escrow: the terms are printed and checked against the acceptance policy (server env is a floor; arguments can only tighten it). ${SIGNS_TX}`,
  { escrowId, ...policyArgsSchema },
  ({ escrowId, ...pol }) => cli(['register-keys', String(escrowId)], undefined, policyEnvFrom(pol)));

tool('sealgate_deliver',
  `Submit a deliverable as the worker: stores the plaintext in records/<id>.json and commits its SHA-256 on-chain. ${SIGNS_TX}`,
  { escrowId, deliverable: z.string().min(1).describe('Deliverable content (plain text)') },
  ({ escrowId, deliverable }) =>
    withTempFile('deliverable.txt', deliverable, (f) => cli(['deliver', String(escrowId), f])));

tool('sealgate_inspect',
  `Run the L0 AI inspection (NEAR AI, verifiable TEE signature) on criteria vs deliverable, then post the encrypted L0 claim from the winning party. Requires NEARAI_API_KEY in the server environment. ${POSTS_CLAIM}`,
  { escrowId },
  ({ escrowId }) => cli(['inspect', String(escrowId)]));

tool('sealgate_decrypt',
  `Decrypt the latest on-chain claim's encrypted AI response as one party, using that party's local X25519 key. Reads local key material; ${READ_ONLY}`,
  { escrowId, party },
  ({ escrowId, party }) => cli(['decrypt', String(escrowId), party]));

tool('sealgate_dispute',
  `Dispute the latest claim as the counterparty, committing the hash of the grounds and posting 2xB0 appeal funding. Grounds must pass the CLI's admissibility check (exit code 2 if inadmissible). ${MOVES_FUNDS}`,
  { escrowId, grounds: z.record(z.string(), z.unknown()).describe('Dispute grounds as a JSON object (see shared/templates.mjs validateGrounds)') },
  ({ escrowId, grounds }) =>
    withTempFile('grounds.json', JSON.stringify(grounds), (f) => cli(['dispute', String(escrowId), f])));

tool('sealgate_respond',
  `As the original claimant, post 1xB0 response funding to a dispute. ${MOVES_FUNDS}`,
  { escrowId },
  ({ escrowId }) => cli(['respond', String(escrowId)]));

tool('sealgate_appeal',
  `Run the L1 appellate review via the registered appellate executor: the appellant first seals the record into an encrypted bundle (appeal-prepare), then the executor opens it, re-checks L0 integrity, runs the blind panel and the clear-error comparison, and posts the L1 claim — the contract accepts L1 claims from the executor account only. Requires NEARAI_API_KEY in the server environment. ${POSTS_CLAIM}`,
  { escrowId },
  async ({ escrowId }) => {
    const prep = await runCli(['appeal-prepare', String(escrowId)]);
    if (prep.code !== 0) return toResult(prep);
    const run = await runCli(['appeal', String(escrowId), `bundles/${escrowId}.json`]);
    return toResult({ code: run.code, output: `${prep.output}\n${run.output}` });
  });

tool('sealgate_cosign',
  `Co-sign the current outcome of an escrow as one party (both co-signatures settle early). ${MOVES_FUNDS}`,
  { escrowId, party },
  ({ escrowId, party }) => cli(['co-sign', String(escrowId), party]));

tool('sealgate_finalize',
  `Finalize an escrow (signed by the buyer account), settling the escrow and its bonds per the final claim. ${MOVES_FUNDS}`,
  { escrowId },
  ({ escrowId }) => cli(['finalize', String(escrowId)]));

await server.connect(new StdioServerTransport());
