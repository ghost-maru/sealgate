// v4 parameterization: terms resolution, bounds, custom-terms lifecycles,
// the appeal fee, and legacy-generation equivalence (design review M1-M8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEAR, createEscrow, submitDeliverable, postClaim, dispute, respondDispute,
  finalizeClaim, ackBundle, termsOf, bondOf, feeOfTerms, defaultTerms, validateTerms,
  APPEAL_FEE, MIN_BOND_FLOOR, CREATE_STORAGE, storageChargeFor,
} from '../contract/machine.mjs';

const A = NEAR;
const t0 = 1_700_000_000_000;
const sum = (plan, to, kind) => plan.transfers.filter((t) => t.to === to && (!kind || t.kind === kind)).reduce((x, t) => x + t.amount, 0n);
const total = (plan) => plan.transfers.reduce((x, t) => x + t.amount, 0n);

function v2base(termsOverrides = {}, amount = A) {
  const terms = defaultTerms({ feeSink: 'platform.near', feeBps: 250, bondBps: 2000, bondFloor: 5n * 10n ** 22n, wMs: 7_200_000, w1Ms: 1_200_000, ...termsOverrides });
  const s = createEscrow({
    buyer: 'buyer.near', worker: 'worker.near', amount, criteriaHash: 'c'.repeat(64),
    deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000,
    executor: 'executor.near', executorKey: '9'.repeat(64), buyerKey: 'a'.repeat(64), workerKey: 'b'.repeat(64),
    terms, now: t0, storagePaid: CREATE_STORAGE,
  });
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now: t0 + 1, storagePaid: storageChargeFor(6) });
  return { s, terms };
}
const B0 = (terms, amount = A) => bondOf(terms, amount);

test('legacy resolution: generations 0 and 1 keep the exact pre-v4 arithmetic', () => {
  // generation 1 (v3): feeSink snapshot, no terms -> 1% / 10%+0.05 / 1h / 30min / no appeal fee
  const s1 = createEscrow({ buyer: 'b', worker: 'w', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 100_000_000, executor: 'e', feeSink: 'sink.near' });
  const t1 = termsOf(s1);
  assert.equal(t1.version, 1); assert.equal(t1.feeBps, 100); assert.equal(feeOfTerms(t1, A), A / 100n);
  assert.equal(bondOf(t1, A), A / 10n); assert.equal(t1.wMs, 3_600_000); assert.equal(t1.appealFee, 0n);
  // generation 0: no sink -> no fee at all
  const s0 = createEscrow({ buyer: 'b', worker: 'w', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 100_000_000, executor: 'e' });
  const t0g = termsOf(s0);
  assert.equal(t0g.version, 0); assert.equal(feeOfTerms(t0g, A), 0n);
});

test('validateTerms enforces the constitutional bounds', () => {
  const ok = defaultTerms({ feeSink: 'p.near', feeBps: 100 });
  assert.doesNotThrow(() => validateTerms(ok, A));
  const bad = (over, why) => assert.throws(() => validateTerms({ ...ok, ...over }, A), why);
  bad({ feeBps: 1001 }, /feeBps/); bad({ feeBps: -1 }, /feeBps/); bad({ feeBps: 1.5 }, /feeBps/);
  bad({ feeBps: 100, feeSink: null }, /sink/);
  bad({ bondBps: 99 }, /bondBps/); bad({ bondBps: 2501 }, /bondBps/);
  bad({ bondFloor: MIN_BOND_FLOOR - 1n }, /bondFloor below/);
  // M4: a floor that prices the counterparty out (above 25% of the amount)
  bad({ bondFloor: A / 2n }, /bondFloor above the cap/);
  bad({ wMs: 3_599_000 }, /wMs/);                    // M3: W/2 reachability floor
  bad({ wMs: 3_600_001 }, /wMs/);                    // S5: whole seconds only
  bad({ w1Ms: 299_000 }, /w1Ms/);                    // protocol W1 floor
  bad({ w1Ms: 31_536_000_000 }, /w1Ms/);             // 30d cap
  // M2: the executor's declared minimum binds harder than the protocol floor
  assert.throws(() => validateTerms({ ...ok, w1Ms: 600_000 }, A, { account: 'e', minW1Ms: 900_000, maxW1Ms: 0 }), /w1Ms/);
  assert.doesNotThrow(() => validateTerms({ ...ok, w1Ms: 900_000 }, A, { account: 'e', minW1Ms: 900_000, maxW1Ms: 0 }));
  // executor's declared maximum binds too (S3)
  assert.throws(() => validateTerms({ ...ok, w1Ms: 7_200_000 }, A, { account: 'e', minW1Ms: 0, maxW1Ms: 3_600_000 }), /w1Ms/);
});

test('v2 lifecycle: bonds and fee come from the snapshot, windows are the snapshot\u2019s', () => {
  const { s, terms } = v2base();
  const reg = new Set();
  const b0 = B0(terms); // max(20% of 1 NEAR, 0.05) = 0.2
  assert.equal(b0, A / 5n);
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: b0, now: t0 + 2, escrowKey: 'x' }, reg);
  // dispute requires the appeal fee, exactly (M8)
  assert.throws(() => dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: b0 * 2n, now: t0 + 3 }), /appeal fee/);
  dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: b0 * 2n, feePaid: APPEAL_FEE, now: t0 + 3 });
  respondDispute(s, { by: 'worker.near', bondPaid: b0, now: t0 + 4 });
  ackBundle(s, { by: 'executor.near', now: t0 + 5 });
  postClaim(s, { by: 'executor.near', executor: 'executor.near', level: 1, verdict: 'PASS', reqHash: 'f'.repeat(64), respHash: '1'.repeat(64), bondPaid: 0n, integrityVoid: false, now: t0 + 6, escrowKey: 'x' }, reg);
  const plan = finalizeClaim(s, {});
  // upheld: fee 2.5% of the amount to the sink; payout is amount - fee
  assert.equal(sum(plan, 'platform.near', 'fee'), (A * 250n) / 10000n);
  assert.equal(sum(plan, 'worker.near', 'escrow'), A - (A * 250n) / 10000n);
  // appellant (buyer) loses its 2*B0 to the claimant (worker); the executor earned the appeal fee
  assert.equal(sum(plan, 'buyer.near'), 0n);
  assert.equal(sum(plan, 'worker.near', 'bond-to-claimant'), b0 * 2n);
  assert.equal(sum(plan, 'executor.near', 'appeal-fee'), APPEAL_FEE);
  // conservation: amount + all bonds + the appeal fee are fully disbursed
  assert.equal(total(plan), A + b0 + b0 * 2n + b0 + APPEAL_FEE);
});

test('appeal fee is refunded when no L1 claim is posted (lapse, acked)', () => {
  const { s, terms } = v2base();
  const reg = new Set();
  const b0 = B0(terms);
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: b0, now: t0 + 2, escrowKey: 'x' }, reg);
  dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: b0 * 2n, feePaid: APPEAL_FEE, now: t0 + 3 });
  respondDispute(s, { by: 'worker.near', bondPaid: b0, now: t0 + 4 });
  ackBundle(s, { by: 'executor.near', now: t0 + 5 });
  const plan = finalizeClaim(s, { now: t0 + 4 + terms.w1Ms + 1 });
  assert.equal(sum(plan, 'buyer.near', 'appeal-fee-refund'), APPEAL_FEE);
  assert.equal(sum(plan, 'executor.near'), 0n);
});

test('custom windows are enforced: dispute after the snapshot W/2 fails even inside the legacy hour', () => {
  const { s, terms } = v2base({ wMs: 3_600_000 }); // W = 1h (the minimum), so W/2 = 30min
  const reg = new Set();
  const b0 = B0(terms);
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: b0, now: t0 + 2, escrowKey: 'x' }, reg);
  assert.throws(() => dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: b0 * 2n, feePaid: APPEAL_FEE, now: t0 + 2 + 1_800_001 }), /W\/2/);
});

test('v2 creation requires the settle window to cover the snapshot W + W1 and the amount minimum', () => {
  const terms = defaultTerms({ feeSink: 'p.near', feeBps: 100, wMs: 7_200_000, w1Ms: 3_600_000 });
  assert.throws(() => createEscrow({ buyer: 'b', worker: 'w', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 1 + 7_200_000 + 3_600_000 - 1, executor: 'e', terms, now: t0, storagePaid: CREATE_STORAGE }), /cover W \+ W1/);
  assert.throws(() => createEscrow({ buyer: 'b', worker: 'w', amount: 10n ** 21n, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 100_000_000, executor: 'e', terms, now: t0 }), /minimum/);
});

test('H1: an executor that has not declared its W1 range cannot anchor a v2 escrow', () => {
  const undeclared = defaultTerms({ feeSink: 'p.near', feeBps: 100, executorMinW1Ms: 0, executorMaxW1Ms: 0 });
  assert.throws(() => validateTerms(undeclared, A), /has not declared/);
  assert.throws(() => createEscrow({ buyer: 'b', worker: 'w', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 100_000_000, executor: 'e', terms: undeclared, now: t0 }), /has not declared/);
});

// Fable review L-8: the canonical terms string is the consent object — the
// contract (QuickJS) and shared/terms.mjs (Node) must produce byte-identical
// hashes. These are FIXED VECTORS taken from live escrows #21 (closed) and
// #22 (open, read back AFTER its claim, so the open anchors are exercised in
// their post-claim state): termsHash() off-chain must reproduce the exact
// hash the contract computed and stored on-chain.
import { termsHash as chainTermsHash } from '../shared/terms.mjs';
test('termsHash fixed vectors: shared implementation reproduces the on-chain hashes of #21/#22', () => {
  const e21 = {
    amount: '500000000000000000000000', open: false, claimBy: 0, deliverWindow: 0, settleWindow: 0,
    deliverBy: 1794328555619, settleBy: 1794414955619, caseType: 'inspection',
    appellateExecutor: 'appeal.sealgate-ghost.testnet', appellateExecutorKey: 'c0f558ae52fef39c1b92abdf54e2bd7b1cf92f1a21454762eaed0b6097960a36',
    feeSink: 'sealgate-ghost.testnet', termsVersion: 2,
    terms: { feeSink: 'sealgate-ghost.testnet', feeBps: 100, bondBps: 2000, bondFloor: '50000000000000000000000', wMs: 7200000, w1Ms: 2700000, appealFee: '10000000000000000000000', executorMinW1Ms: 1800000, executorMaxW1Ms: 604800000 },
  };
  assert.equal(chainTermsHash(e21), 'cd540ef3d9e171bc3757c3b0e6244fce3ed1352b0d2356979850b8ad965812dc');
  const e22 = {
    amount: '400000000000000000000000', open: true, claimBy: 1794246280430, deliverWindow: 3600000, settleWindow: 7200000,
    deliverBy: 1794246327386, settleBy: 1794253527386, caseType: 'inspection',
    appellateExecutor: 'appeal.sealgate-ghost.testnet', appellateExecutorKey: 'c0f558ae52fef39c1b92abdf54e2bd7b1cf92f1a21454762eaed0b6097960a36',
    feeSink: 'sealgate-ghost.testnet', termsVersion: 2,
    terms: { feeSink: 'sealgate-ghost.testnet', feeBps: 250, bondBps: 1000, bondFloor: '50000000000000000000000', wMs: 3600000, w1Ms: 1800000, appealFee: '10000000000000000000000', executorMinW1Ms: 1800000, executorMaxW1Ms: 604800000 },
  };
  assert.equal(chainTermsHash(e22), '5597e0afa3e97a4ff2bc34a8fa3b53e7edddbfebd5e37d1c1cafd2983afb67b4');
});
