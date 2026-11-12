// One-command judge reproduction for Sealgate (no API key, no account needed).
//   node scripts/reproduce.mjs
// Checks, against LIVE testnet state:
//   0. The deployed contract's code hash equals this repo's build/sealgate.wasm.
//   1. Escrow #2 (the public demo record): full integrity + response-binding
//      verification of its claim, from chain state and records/2.json.
//   2. Escrow #4's forged L0 claim FAILS the same integrity check (negative test),
//      and its on-chain appellate claim carries integrityVoid = true.
//   3. The final states of escrows #0, #1, #3 match the README's flow table.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONTRACT, view } from '../cli/chain.mjs';
import { verifyIntegrity, verifyResponseBinding } from '../shared/verify.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58encode = (buf) => {
  let n = BigInt('0x' + Buffer.from(buf).toString('hex'));
  let s = '';
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  return s;
};

// 0. Deployed code == repo build. (The public RPC throttles under load —
// retry the first fetch a few times before concluding anything.)
const rpcFetch = async (payload) => {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch('https://rpc.testnet.near.org', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) return await r.json();
    } catch { /* fall through to retry */ }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error('testnet RPC unreachable after retries');
};
const acct = await rpcFetch({ jsonrpc: '2.0', id: '1', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: CONTRACT } });
const localHash = b58encode(createHash('sha256').update(readFileSync(new URL('../build/sealgate.wasm', import.meta.url))).digest());
check('deployed code hash == build/sealgate.wasm', acct.result.code_hash === localHash, localHash);

const signers = (await view('get_signers', {})).map((s) => s.split(':')[1]);
const escrow = (id) => view('get_escrow', { escrow_id: id });
const rec = (id) => JSON.parse(readFileSync(new URL(`../records/${id}.json`, import.meta.url), 'utf8'));

// 1. Escrow #2: full verification of the (only) claim.
{
  const e = await escrow(2); const r = rec(2); const claim = e.claims[e.claims.length - 1];
  const a = verifyIntegrity({ criteria: r.criteria, deliverable: r.deliverable, escrowRef: `${CONTRACT}#2`, claim, registeredSigners: signers });
  const b = verifyResponseBinding({ claim, responseBytes: Buffer.from(r.l0.responseB64, 'base64'), registeredSigners: signers });
  check('escrow #2 claim verifies (integrity + response binding)', a.failures.length === 0 && b.length === 0, `verdict ${claim.verdict}, phase ${e.phase}`);
}

// 2. Escrow #4: the forged claim must FAIL integrity; the appellate claim is VOID.
{
  const e = await escrow(4); const r = rec(4);
  const forged = e.claims[0];
  const a = verifyIntegrity({ criteria: r.criteria, deliverable: r.deliverable, escrowRef: `${CONTRACT}#4`, claim: forged, registeredSigners: signers });
  check('escrow #4 forged L0 claim fails integrity', a.failures.length > 0, a.failures[0] || '');
  check('escrow #4 appellate claim is integrityVoid on-chain', e.claims[1]?.integrityVoid === true && e.phase === 'Final', `outcome ${e.outcome}`);
}

// 3. Flow table for the remaining escrows.
const expect = [
  [0, 'Final', 'PASS', 1, false],
  [1, 'Final', 'FAIL', 2, true],
  [3, 'Final', 'FAIL', 2, true],
];
for (const [id, phase, outcome, nClaims, hasDispute] of expect) {
  const e = await escrow(id);
  check(`escrow #${id} final state`, e.phase === phase && e.outcome === outcome && e.claims.length === nClaims && (!!e.dispute === hasDispute),
    `phase ${e.phase}, outcome ${e.outcome}, claims ${e.claims.length}, dispute ${!!e.dispute}`);
}

// 4. L1 redesign (2026-11-09): the registered appellate executor — and only it —
// posts L1 claims. Escrow #8 replays the #4 forgery against the new contract:
// the forged claim is voided, and the L1 claim's poster is the executor.
{
  const executor = (await view('get_appellate_executor', {})).account;
  check('appellate executor registered on-chain', executor === 'appeal.sealgate-ghost.testnet', executor);
  const e8 = await escrow(8);
  check('escrow #8 L1 claim posted by the executor, integrityVoid, Final',
    e8.claims[1]?.by === executor && e8.claims[1]?.integrityVoid === true && e8.phase === 'Final',
    `L1 by ${e8.claims[1]?.by}, phase ${e8.phase}`);
  const e9 = await escrow(9);
  check('escrow #9 two-agent trade settled Final/PASS', e9.phase === 'Final' && e9.outcome === 'PASS', `phase ${e9.phase}, outcome ${e9.outcome}`);
  const e10 = await escrow(10);
  check('escrow #10 post-F1-fix: executor VOID on the forgery, Final (tampered bundle was refused off-chain)',
    e10.claims[1]?.by === executor && e10.claims[1]?.integrityVoid === true && e10.phase === 'Final',
    `L1 by ${e10.claims[1]?.by}, phase ${e10.phase}`);
  // Round-3 batch: per-escrow keys, executor-derived response key, ack
  // attribution, snapshot keys. #11 salt-shifted bundle refused off-chain;
  // #12 garbage (undecryptable) claim VOID as a claimant-side failure;
  // #13 properly-encrypted forgery VOID on the req_hash integrity failure.
  for (const n of [11, 12, 13]) {
    const eN = await escrow(n);
    check(`escrow #${n} round-3: executor VOID, ack recorded, executor+key snapshotted, Final`,
      eN.claims[1]?.by === executor && eN.claims[1]?.integrityVoid === true && eN.phase === 'Final'
        && eN.dispute?.acked === true && eN.appellateExecutor === executor && !!eN.appellateExecutorKey,
      `phase ${eN.phase}, acked ${eN.dispute?.acked}`);
  }
  // #14 round-4 (R1): the worker submitted a garbage on-chain deliverable
  // ciphertext (deliverable withheld/broken). The executor recovered the
  // record from chain, found it unusable — a worker-side record failure —
  // and posted VOID/FAIL; the forger lost 2xB0. The deliverable is now part
  // of the submission itself (salted flag + ciphertext stored on-chain).
  const e14 = await escrow(14);
  check('escrow #14 round-4: withheld deliverable is a worker-side VOID/FAIL, Final',
    e14.claims[1]?.by === executor && e14.claims[1]?.integrityVoid === true && e14.outcome === 'FAIL'
      && e14.phase === 'Final' && e14.dispute?.acked === true && e14.salted === true && !!e14.deliverableCipher,
    `phase ${e14.phase}, outcome ${e14.outcome}`);
  // #15 round-4: properly-encrypted forgery still VOIDs on the req_hash
  // integrity failure, with the deliverable recovered from the on-chain
  // ciphertext and judged PASS by the blind panel.
  // #16: the two-independent-agents demo re-run end-to-end after the
  // round-4 changes (new deliver path with the on-chain ciphertext).
  const e16 = await escrow(16);
  check('escrow #16 round-4: two-agents re-run, Final/PASS, deliverable ciphertext on-chain',
    e16.phase === 'Final' && e16.outcome === 'PASS' && e16.salted === true && !!e16.deliverableCipher,
    `phase ${e16.phase}, outcome ${e16.outcome}`);
  // #17 round-5 (S1): the worker submitted a garbage deliverable
  // ciphertext, the buyer posted an honest FAIL anyway, and the worker
  // appealed its OWN defective submission. The executor refused before
  // the ack (acked stays false on-chain), the appeal lapsed unacked, the
  // worker's 2xB0 went to the buyer, and the FAIL stands.
  const e17 = await escrow(17);
  check('escrow #17 round-5: worker appealing its own broken ciphertext refused pre-ack, unacked lapse, Final/FAIL',
    e17.phase === 'Final' && e17.outcome === 'FAIL' && e17.dispute?.acked === false && e17.claims.length === 1
      && e17.salted === true && !!e17.deliverableCipher,
    `phase ${e17.phase}, outcome ${e17.outcome}, acked ${e17.dispute?.acked}`);
  const e15 = await escrow(15);
  check('escrow #15 round-4: encrypted forgery VOID, deliverable from chain, Final/PASS',
    e15.claims[1]?.by === executor && e15.claims[1]?.integrityVoid === true && e15.outcome === 'PASS'
      && e15.phase === 'Final' && e15.dispute?.acked === true && e15.salted === true && !!e15.deliverableCipher,
    `phase ${e15.phase}, outcome ${e15.outcome}`);

  // v3 generalization (2026-11-10): the judge platform beyond inspection.
  const sink = await view('get_fee_sink', {});
  check('platform fee sink registered on-chain', sink === 'sealgate-ghost.testnet', sink);
  // #18: an OPEN JOB posted with no worker, claimed by another account,
  // judged PASS, settled with the 1% fee snapshotted on the escrow.
  const e18 = await escrow(18);
  check('escrow #18 v3: open job claimed and settled Final/PASS (fee sink snapshotted)',
    e18.phase === 'Final' && e18.outcome === 'PASS' && e18.open === true && !!e18.claimedAt
      && e18.worker === 'sgworker-ghost.testnet' && e18.feeSink === 'sealgate-ghost.testnet'
      && (e18.caseType ?? 'inspection') === 'inspection',
    `phase ${e18.phase}, outcome ${e18.outcome}, claimedAt ${e18.claimedAt}`);
  // #19: ADJUDICATION case type — a marketplace payout-withholding appeal;
  // L0 PASS for the seller, the platform appealed, the panel UPHELD.
  const e19 = await escrow(19);
  check('escrow #19 v3: adjudication (payout appeal) Final/PASS, appeal upheld, executor acked',
    e19.phase === 'Final' && e19.outcome === 'PASS' && e19.caseType === 'adjudication'
      && e19.claims.length === 2 && e19.claims[1]?.by === executor && e19.claims[1]?.integrityVoid === false
      && e19.dispute?.acked === true && e19.feeSink === 'sealgate-ghost.testnet',
    `phase ${e19.phase}, outcome ${e19.outcome}, claims ${e19.claims.length}`);
  // #20: ADJUDICATION — a grant milestone judged FAIL (two of three required
  // elements absent), the grantee appealed, the panel UPHELD the FAIL.
  const e20 = await escrow(20);
  check('escrow #20 v3: adjudication (grant milestone) Final/FAIL, appeal upheld, executor acked',
    e20.phase === 'Final' && e20.outcome === 'FAIL' && e20.caseType === 'adjudication'
      && e20.claims.length === 2 && e20.claims[1]?.by === executor && e20.claims[1]?.integrityVoid === false
      && e20.dispute?.acked === true && e20.feeSink === 'sealgate-ghost.testnet',
    `phase ${e20.phase}, outcome ${e20.outcome}, claims ${e20.claims.length}`);

  // v4 parameterization (2026-11-10): per-escrow terms inside constitutional
  // bounds, the fee as a registered schedule, the executor's declared W1 range.
  // #21: CLOSED escrow with NON-DEFAULT terms (bond rate 20%, W 2h, W1 45min)
  // taken through a full appeal — L0 FAIL, panel UPHOLD; the appeal fee was
  // routed to the executor and settlement matched the snapshot to the digit.
  const e21 = await escrow(21);
  check('escrow #21 v4: non-default terms (bond 20%, W 2h, W1 45min) Final/FAIL, appeal upheld, executor acked',
    e21.phase === 'Final' && e21.outcome === 'FAIL' && e21.termsVersion === 2
      && e21.terms?.bondBps === 2000 && e21.terms?.wMs === 7200000 && e21.terms?.w1Ms === 2700000
      && e21.terms?.appealFee === '10000000000000000000000' && !!e21.termsHash
      && e21.claims.length === 2 && e21.claims[1]?.by === executor && e21.dispute?.acked === true,
    `phase ${e21.phase}, outcome ${e21.outcome}, termsHash ${(e21.termsHash ?? '').slice(0, 12)}`);
  // #22: OPEN JOB created while the fee schedule was 250 bps — the escrow
  // snapshotted 2.5% (the schedule was later restored to 100 bps) and settled
  // at 2.5%; the worker's claim recomputed the same terms hash off-chain.
  const e22 = await escrow(22);
  check('escrow #22 v4: open job snapshotted at 250 bps schedule, Final/PASS settled at 2.5%',
    e22.phase === 'Final' && e22.outcome === 'PASS' && e22.termsVersion === 2 && e22.open === true
      && e22.terms?.feeBps === 250 && e22.worker === 'sgworker-ghost.testnet' && !!e22.termsHash,
    `phase ${e22.phase}, outcome ${e22.outcome}, feeBps ${e22.terms?.feeBps}`);
  const sched = await view('get_fee_schedule', {});
  check('fee schedule restored to 100 bps after the #22 proof', sched.bps === 100 && sched.account === 'sealgate-ghost.testnet', `${sched.bps} bps to ${sched.account}`);
  const execReg = await view('get_appellate_executor', {});
  check('appellate executor W1 range declared on-chain (30min..7d)',
    execReg.min_w1_ms === 1800000 && execReg.max_w1_ms === 604800000,
    `min ${execReg.min_w1_ms}, max ${execReg.max_w1_ms}`);
  // #24: the v5 storage-economics proof. The escrow was created with the
  // creator's storage deposit, the worker funded the deliverable ciphertext
  // and the claimant the response ciphertext (per-byte, at the protocol
  // price), settled Final/PASS — and was then PRUNED by both parties'
  // consent: ciphertexts deleted, every storage payment refunded to its
  // payer minus the 0.01 NEAR record rent retained on-chain, while the
  // hashes, verdict and outcome remain.
  const e24 = await escrow(24);
  check('escrow #24 v5: storage-funded lifecycle settled Final/PASS and pruned by both parties',
    e24.phase === 'Final' && e24.outcome === 'PASS' && e24.pruned === true
      && e24.deliverableCipher === null && e24.claims[0]?.encryptedResponse === ''
      && e24.retainedRent === '10000000000000000000000'
      && e24.createStorage === '0' && e24.deliverableStorage === '0' && e24.claims[0]?.storagePaid === '0'
      && e24.claims[0]?.verdict === 'PASS' && !!e24.claims[0]?.respHash && !!e24.deliverableHash
      && (e24.pruneConsent ?? []).length === 2,
    `phase ${e24.phase}, outcome ${e24.outcome}, pruned ${e24.pruned}, retainedRent ${e24.retainedRent}`);
}

// 5. Completeness (Fable full review): the escrow count covers the whole
// documented table, and the platform fees implied by every claim-settled
// escrow's OWN terms add up to exactly the fee sink's on-chain balance —
// the README's "0.038 NEAR of fees" is computed here, not asserted.
{
  const { feeOfChain } = await import('../shared/terms.mjs');
  const count = await view('escrow_count', {});
  check('escrow count covers the documented table (#0-#24)', count >= 25, `${count} escrows on-chain`);
  let feeSum = 0n;
  for (let id = 0; id < count; id++) {
    const e = await escrow(id);
    if (e.phase === 'Final' && e.claims.length > 0 && e.outcome) feeSum += feeOfChain(e);
  }
  const sinkBal = BigInt(await view('get_balance', { account: 'sealgate-ghost.testnet' }));
  check('sum of per-escrow fees (from terms) == fee sink balance', feeSum === sinkBal,
    `${(Number(feeSum) / 1e24).toFixed(3)} NEAR implied, ${(Number(sinkBal) / 1e24).toFixed(3)} NEAR in the sink`);
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
