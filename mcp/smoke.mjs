// Smoke test for the Sealgate MCP server: spawns it over stdio with the SDK
// client, lists tools, and runs two read-only calls against escrow #2 on the
// public testnet RPC. No API key needed. Usage: node mcp/smoke.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const EXPECTED = [
  'sealgate_show', 'sealgate_verify', 'sealgate_receipt', 'sealgate_verify_receipt',
  'sealgate_create', 'sealgate_create_open', 'sealgate_open_jobs', 'sealgate_claim_job', 'sealgate_register_keys', 'sealgate_deliver', 'sealgate_inspect',
  'sealgate_decrypt', 'sealgate_dispute', 'sealgate_respond', 'sealgate_appeal',
  'sealgate_cosign', 'sealgate_finalize',
];

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n  ${detail}` : ''}`);
  if (!ok) failed++;
}
const textOf = (res) => (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// Pass our environment through (e.g. SEALGATE_CONTRACT) as a real MCP client would.
const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER], env: { ...process.env }, stderr: 'inherit' });
const client = new Client({ name: 'sealgate-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  check('initialize', true);

  const { tools } = await client.listTools();
  const names = new Set(tools.map((t) => t.name));
  const missing = EXPECTED.filter((n) => !names.has(n));
  check(`tools/list has all ${EXPECTED.length} tools`, missing.length === 0, `missing: ${missing.join(', ')}`);

  const show = await client.callTool({ name: 'sealgate_show', arguments: { escrowId: 2 } });
  const showText = textOf(show);
  check('sealgate_show escrow 2 mentions "phase"', !show.isError && showText.includes('"phase"'), showText.slice(0, 400));

  const verify = await client.callTool({ name: 'sealgate_verify', arguments: { escrowId: 2 } });
  const verifyText = textOf(verify);
  check('sealgate_verify escrow 2 has "integrity failures: []"', !verify.isError && verifyText.includes('integrity failures: []'), verifyText.slice(0, 400));
} catch (err) {
  check('unexpected error', false, err.stack || String(err));
} finally {
  await client.close().catch(() => {});
}

console.log(failed ? `FAIL (${failed} check(s) failed)` : 'PASS (all checks)');
process.exit(failed ? 1 : 0);
