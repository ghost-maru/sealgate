// v4 post-redeploy setup (owner calls): declare the appellate executor's
// W1 range (H1 — v2 escrow creation refuses an undeclared range) and
// register the platform fee schedule (M1). Idempotent; safe to re-run.
// MUST run right after the v4 redeploy: until it does, every v2 create
// reverts with "appellate executor has not declared a W1 range".
// Usage: node scripts/setup-v4.mjs
import { readFileSync } from 'node:fs';
import { call, view, ACCOUNTS } from '../cli/chain.mjs';
import { getPublicKeyHex } from '../shared/encrypt.mjs';

// Declared range (diff review R2): the minimum is 30 minutes — the legacy
// default W1 — until the appellate pipeline latency (ack -> L1 post) is
// actually measured; the measurement basis goes into PARAMETERS.md when it
// replaces this value. The maximum bounds how long a bundle + keys must be
// retained per case.
const MIN_W1_MS = 1_800_000;     // 30 minutes
const MAX_W1_MS = 604_800_000;   // 7 days
const FEE_BPS = 100;             // 1% to the root account (the platform sink)

const execKeys = JSON.parse(readFileSync('.keys/executor-x25519.json', 'utf8'));
// R5: the registered public key must correspond to the secret the executor
// actually holds, or every future escrow snapshots an unopenable key.
if (getPublicKeyHex(execKeys.secretKey) !== execKeys.publicKey) {
  throw new Error('executor-x25519.json: publicKey does not match secretKey — refusing to register');
}

await call('root', 'set_appellate_executor', {
  account: ACCOUNTS.executor, x25519_pub: execKeys.publicKey,
  min_w1_ms: MIN_W1_MS,
  max_w1_ms: MAX_W1_MS,
});
const exec = await view('get_appellate_executor', {});
console.log('executor registered with declared W1 range:', exec);
if (exec.account !== ACCOUNTS.executor || exec.x25519_pub !== execKeys.publicKey
  || exec.min_w1_ms !== MIN_W1_MS || exec.max_w1_ms !== MAX_W1_MS) {
  throw new Error(`executor registration mismatch: ${JSON.stringify(exec)}`);
}

await call('root', 'set_fee_schedule', { account: ACCOUNTS.root, bps: FEE_BPS });
const sched = await view('get_fee_schedule', {});
console.log('fee schedule:', sched);
if (sched.account !== ACCOUNTS.root || sched.bps !== FEE_BPS) {
  throw new Error(`fee schedule mismatch: ${JSON.stringify(sched)}`);
}
console.log('setup-v4: all values verified on-chain.');
