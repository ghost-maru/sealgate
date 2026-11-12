#!/usr/bin/env node
// Sealgate v7 CLI (SPEC-v7-KERNEL appendix A, stage 3).
//
//   node cli/main.mjs demo                          offline end-to-end walkthrough (in-memory contract, mock AI)
//   node cli/main.mjs --sandbox <command> ...       one command against a fresh offline sandbox
//   SEALGATE_LIVE=1 ... node cli/main.mjs <command> ...   live testnet
//
// Commands: create, preflight, submit, appeal, respond, clerk-step, finalize,
// open, verify, show, register-key, withdraw.
//
// Common options:
//   --account <id>        acting account (live: needs SEALGATE_ACCOUNT_KEY_FILE;
//                         sandbox: alice.testnet / bob.testnet / clerk.testnet / owner.testnet)
//   --contract <id>       contract account (live; sandbox fixes sealgate7.testnet)
//   --cases-dir <dir>     local case material (default: $SEALGATE_CASES_DIR or ~/.sealgate7/cases)
//   --seal-key-file <f>   X25519 sealing secret (64 hex chars; sandbox: the party's sandbox key)
//
// Exit codes (cli/util.mjs EXIT): 0 ok; 1 a check failed; 2 refused / usage
// error (nothing sent); 3 finalize refused by the k2 client rule (§7.6).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { keypair, fromHex, toHex, utf8 } from '../shared/seal.mjs';
import { verifyTeeSignature } from '../shared/tee.mjs';
import { runtimeConfig, RELEASE_MARGIN_MS } from '../clerk/config.mjs';
import { nearChain, MachineChain } from '../clerk/chain.mjs';
import { nearAiCloud } from '../clerk/ai.mjs';
import { createClerk } from '../clerk/service.mjs';
import { createSandbox, R, S, CLERK, OWNER } from '../clerk/sandbox.mjs';
import { mockAi, verifyMockSignature } from '../clerk/mock-ai.mjs';
import { demoBehavior } from '../clerk/demo.mjs';
import * as cmd from './commands.mjs';
import { CliError, EXIT, parseArgv, parseNear, parseYocto, parseDuration, parseCaseId, parseTemplateRef } from './util.mjs';

const readBytes = (p) => new Uint8Array(readFileSync(p));
function readSealKey(path) {
  const hex = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new CliError(`${path} must hold 64 lowercase hex chars`);
  return keypair(fromHex(hex));
}

function buildLiveCtx(flags) {
  const cfg = runtimeConfig();
  if (!cfg.live) throw new CliError('network access is off: set SEALGATE_LIVE=1 (or use --sandbox / demo)');
  const account = flags.account || process.env.SEALGATE_ACCOUNT;
  const keyFile = process.env.SEALGATE_ACCOUNT_KEY_FILE;
  if (!account || !keyFile) throw new CliError('live mode needs --account (or SEALGATE_ACCOUNT) and SEALGATE_ACCOUNT_KEY_FILE');
  const contract = flags.contract || cfg.contract;
  if (!contract) throw new CliError('live mode needs --contract (or SEALGATE7_CONTRACT)');
  const chain = nearChain({ contractId: contract, rpcUrl: cfg.rpcUrl, accountId: account, keyFile });
  const sealKey = flags['seal-key-file'] ? readSealKey(flags['seal-key-file']) : (process.env.SEALGATE_SEAL_KEY_FILE ? readSealKey(process.env.SEALGATE_SEAL_KEY_FILE) : null);
  return {
    chain, account, sealKey,
    casesDir: flags['cases-dir'] || process.env.SEALGATE_CASES_DIR || join(homedir(), '.sealgate7', 'cases'),
    out: (s) => console.log(s),
    verifySignature: verifyTeeSignature,
    marginMs: RELEASE_MARGIN_MS,
    makeClerk: async () => {
      if (!cfg.nearAiApiKey) throw new CliError('clerk-step needs NEARAI_API_KEY');
      if (!sealKey) throw new CliError('clerk-step needs the clerk sealing key');
      const ai = nearAiCloud({ apiKey: cfg.nearAiApiKey });
      return createClerk({ chain, ai, clerkSk: sealKey.sk, verifySignature: verifyTeeSignature, log: (s) => console.log(s) });
    },
  };
}

const SANDBOX_ACCOUNTS = { [R]: 'R', [S]: 'S', [CLERK]: 'clerk', [OWNER]: 'owner' };
async function buildSandboxWorld() {
  const sb = createSandbox();
  await sb.register();
  return sb;
}
function sandboxCtx(sb, account, casesDir) {
  const role = SANDBOX_ACCOUNTS[account];
  if (!role) throw new CliError(`sandbox accounts: ${Object.keys(SANDBOX_ACCOUNTS).join(', ')}`);
  const chain = new MachineChain(sb.m, { accountId: account, clock: sb.clock });
  const keyOf = { R: sb.keys.R, S: sb.keys.S, clerk: sb.keys.clerk, owner: null }[role];
  return {
    chain, account, sealKey: keyOf, casesDir,
    out: (s) => console.log(s),
    verifySignature: verifyMockSignature,
    marginMs: RELEASE_MARGIN_MS,
    makeClerk: async () => createClerk({ chain: sb.clerk, ai: mockAi(demoBehavior), clerkSk: sb.keys.clerk.sk, verifySignature: verifyMockSignature, log: (s) => console.log(s) }),
    sandbox: sb,
  };
}

async function dispatch(ctx, name, pos, flags) {
  const caseId = () => parseCaseId(pos[0] ?? flags.case);
  switch (name) {
    case 'create':
      return cmd.cmdCreate(ctx, {
        clerk: flags.clerk, template: flags.template ? parseTemplateRef(flags.template) : undefined,
        submitter: flags.submitter, criteria: flags.criteria ? readBytes(flags.criteria) : undefined,
        zeroth: flags['zeroth-decision'] ? readBytes(flags['zeroth-decision']) : undefined,
        amount: flags.amount !== undefined ? parseNear(flags.amount) : undefined,
        bond: flags.bond !== undefined ? parseNear(flags.bond) : undefined,
        submitWindowSec: flags['submit-window'] !== undefined ? parseDuration(flags['submit-window'], 'submit window') : 86400,
        wSec: flags.w !== undefined ? parseDuration(flags.w, 'W') : undefined,
        dryRun: !!flags['dry-run'], allowMissingInputs: !!flags['allow-missing-inputs'],
      });
    case 'preflight':
      return cmd.cmdPreflight(ctx, {
        caseId: caseId(), submission: flags.submission ? readBytes(flags.submission) : undefined,
        showTemplate: !!flags['show-template'],
        requestOut: flags['request-out'] ? (bytes) => { writeFileSync(flags['request-out'], bytes); return flags['request-out']; } : undefined,
      });
    case 'submit':
      return cmd.cmdSubmit(ctx, {
        caseId: caseId(), submission: flags.submission ? readBytes(flags.submission) : undefined,
        expectDeposit: flags['expect-deposit'] !== undefined ? parseYocto(flags['expect-deposit'], 'expect-deposit') : undefined,
        dryRun: !!flags['dry-run'], allowMissingInputs: !!flags['allow-missing-inputs'],
      });
    case 'appeal':
      return cmd.cmdAppeal(ctx, { caseId: caseId(), expectDeposit: flags['expect-deposit'] !== undefined ? parseYocto(flags['expect-deposit'], 'expect-deposit') : undefined, dryRun: !!flags['dry-run'] });
    case 'respond':
      return cmd.cmdRespond(ctx, { caseId: caseId(), dryRun: !!flags['dry-run'] });
    case 'clerk-step':
      return cmd.cmdClerkStep(ctx, { caseId: caseId() });
    case 'finalize':
      return cmd.cmdFinalize(ctx, { caseId: caseId(), force: !!flags.force });
    case 'open':
      return cmd.cmdOpen(ctx, { caseId: caseId(), writeOut: flags.out ? (bytes) => { writeFileSync(flags.out, bytes); return flags.out; } : undefined, print: flags.print ? true : undefined });
    case 'verify': {
      const r = await cmd.cmdVerify(ctx, { caseId: caseId(), templateBody: flags['template-file'] ? readBytes(flags['template-file']) : undefined });
      if (!r.ok) process.exitCode = EXIT.CHECK_FAILED;
      return r;
    }
    case 'show':
      return cmd.cmdShow(ctx, { caseId: caseId() });
    case 'register-key':
      return cmd.cmdRegisterKey(ctx);
    case 'withdraw':
      return cmd.cmdWithdraw(ctx, { amount: flags.amount !== undefined ? parseNear(flags.amount) : undefined });
    default:
      throw new CliError(`unknown command: ${name} (create | preflight | submit | appeal | respond | clerk-step | finalize | open | verify | show | register-key | withdraw | demo)`);
  }
}

// Offline walkthrough: every CLI command against one sandbox, in one process.
async function demo() {
  const sb = await buildSandboxWorld();
  const casesDir = mkdtempSync(join(tmpdir(), 'sealgate7-cli-demo-'));
  const as = (account) => sandboxCtx(sb, account, casesDir);
  const out = (s) => console.log(s);
  out('== Sealgate v7 CLI demo (offline sandbox, mock AI) ==');

  out('\n-- R creates an inspection case (5 NEAR, W 1h) --');
  const criteria = utf8('# Acceptance criteria\nA market report on five competitors, including a price table.');
  const created = await cmd.cmdCreate(as(R), { clerk: CLERK, template: { id: 'inspection', version: 1 }, submitter: S, criteria, amount: 5n * 10n ** 24n, submitWindowSec: 86400, wSec: 3600 });
  const id = created.caseId;

  out('\n-- S preflights and submits --');
  const submission = utf8('# Deliverables\nReport on five competitors. Section 4: price table.');
  await cmd.cmdPreflight(as(S), { caseId: id, submission });
  await cmd.cmdSubmit(as(S), { caseId: id, submission });

  out('\n-- clerk decides (one step) --');
  await cmd.cmdClerkStep(as(CLERK), { caseId: id });

  out('\n-- time passes: the PASS becomes final (W/2), finalize releases k2 --');
  sb.advance(1800_000 + 60_000);
  await cmd.cmdFinalize(as(S), { caseId: id });

  out('\n-- R opens the submission --');
  const opened = await cmd.cmdOpen(as(R), { caseId: id });
  out(`opened submission equals the submitted bytes: ${Buffer.from(opened.submission).equals(Buffer.from(submission))}`);

  out('\n-- both parties verify (§9) --');
  const vR = await cmd.cmdVerify(as(R), { caseId: id });
  const vS = await cmd.cmdVerify(as(S), { caseId: id });
  out(`verify as R: ${vR.ok ? 'OK' : 'FAILED'}; verify as S: ${vS.ok ? 'OK' : 'FAILED'}`);
  if (!vR.ok || !vS.ok) process.exitCode = EXIT.CHECK_FAILED;
  out('\n== demo done ==');
}

async function main() {
  const raw = process.argv.slice(2);
  const sandbox = raw.includes('--sandbox');
  const argv = raw.filter((a) => a !== '--sandbox');
  if (!argv.length || argv[0] === '--help' || argv[0] === 'help') {
    console.log('usage: node cli/main.mjs [--sandbox] <create|preflight|submit|appeal|respond|clerk-step|finalize|open|verify|show|register-key|withdraw> [case-id] [flags]\n       node cli/main.mjs demo');
    return;
  }
  if (argv[0] === 'demo') { await demo(); return; }
  const parsed = parseArgv(argv);
  const name = parsed.pos[0];
  const { pos, flags } = parsed;
  let ctx;
  if (sandbox) {
    const sb = await buildSandboxWorld();
    const account = flags.account || R;
    ctx = sandboxCtx(sb, account, flags['cases-dir'] || mkdtempSync(join(tmpdir(), 'sealgate7-cli-sandbox-')));
    console.log(`(sandbox: fresh in-memory contract on ${ctx.chain.contractId}; state does not persist between runs — use demo for a full walkthrough)`);
  } else {
    ctx = buildLiveCtx(flags);
  }
  const result = await dispatch(ctx, name, pos.slice(1), flags);
  if (flags.json && result !== undefined) console.log(JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString('base64') : v), 2));
}

main().catch((e) => {
  if (e instanceof CliError) { console.error(`error: ${e.message}`); process.exit(e.exitCode); }
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
