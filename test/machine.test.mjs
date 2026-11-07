import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR, createEscrow, submitDeliverable, postClaim, dispute, respondDispute, coSign, finalizeClaim, expire, bond0, bond1 } from '../contract/machine.mjs';

const A = NEAR; // 1 NEAR escrow
const t0 = 1_000_000_000;
const base = () => {
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000 });
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), now: t0 + 1 });
  return s;
};
const claimL0 = (s, reg, verdict = 'PASS', by = 'worker.near') =>
  postClaim(s, { by, level: 0, verdict, reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bond0(A), now: t0 + 2 }, reg);
const sum = (plan, to, kind) => plan.transfers.filter((t) => t.to === to && (!kind || t.kind === kind)).reduce((x, t) => x + t.amount, 0n);

test('bond schedule: B0 = max(10%, 0.05), B1 = 2xB0', () => {
  assert.equal(bond0(A), A / 10n);
  assert.equal(bond1(A), A / 5n);
  assert.equal(bond0(NEAR / 100n), 5n * 10n ** 22n);
});

test('happy path: undisputed PASS claim pays worker, bond returns', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg);
  const plan = finalizeClaim(s, { now: t0 + 2 + 3_600_000 + 1 });
  assert.equal(plan.outcome, 'PASS');
  assert.equal(sum(plan, 'worker.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'bond-return'), bond0(A));
  assert.equal(s.phase, 'Final');
});

test('fast finality: both parties co-sign settles immediately', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'FAIL', 'worker.near');
  assert.equal(coSign(s, { by: 'worker.near' }), null);
  const plan = coSign(s, { by: 'buyer.near' });
  assert.equal(plan.outcome, 'FAIL');
  assert.equal(sum(plan, 'buyer.near', 'escrow'), A);
});

const W_ = 3_600_000, W1_ = 1_800_000;
const L0_AT = t0 + 2; // claimL0 timestamp
const openDispute = (s, now = t0 + 3) =>
  dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: bond1(A), now });
const fund = (s, now = t0 + 4) => respondDispute(s, { by: 'worker.near', bondPaid: bond0(A), now });
const claimL1 = (s, reg, verdict, extra = {}) =>
  postClaim(s, { by: 'buyer.near', level: 1, verdict, reqHash: 'f'.repeat(64), respHash: '1'.repeat(64), bondPaid: bond0(A), now: t0 + 5, ...extra }, reg);

test('dispute: appellant must post 2xB0 and dispute within W/2', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  assert.throws(() => dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: bond0(A), now: t0 + 3 }), /below 2xB0/);
  assert.throws(() => openDispute(s, L0_AT + W_ / 2 + 1), /W\/2/);
  const d = openDispute(s, L0_AT + W_ / 2); // boundary is inclusive
  assert.equal(d.funded, false);
  assert.equal(d.respondentBond, 0n);
  assert.equal(s.phase, 'Disputed');
});

test('respondDispute: only the L0 claimant, >= B0, by claim time + W, once', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s);
  assert.throws(() => respondDispute(s, { by: 'buyer.near', bondPaid: bond0(A), now: t0 + 4 }), /only the L0 claimant/);
  assert.throws(() => respondDispute(s, { by: 'worker.near', bondPaid: bond0(A) - 1n, now: t0 + 4 }), /below B0/);
  assert.throws(() => respondDispute(s, { by: 'worker.near', bondPaid: bond0(A), now: L0_AT + W_ + 1 }), /response window has closed/);
  fund(s, L0_AT + W_);
  assert.equal(s.dispute.funded, true);
  assert.equal(s.dispute.respondentBond, bond0(A));
  assert.throws(() => fund(s), /already funded/);
});

test('L1 claim throws when the appeal is not funded', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s);
  assert.throws(() => claimL1(s, reg, 'FAIL'), /not funded/);
});

test('L1 claim: bond is B0 and deadline is claim time + W + W1', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  assert.throws(() => claimL1(s, reg, 'FAIL', { bondPaid: bond0(A) - 1n }), /below B0/);
  assert.throws(() => claimL1(s, reg, 'FAIL', { now: L0_AT + W_ + W1_ + 1 }), /not prosecuted/);
  claimL1(s, reg, 'FAIL', { now: L0_AT + W_ + W1_ });
  assert.equal(s.phase, 'Claimed');
});

test('dispute upheld: appellant 2xB0 to claimant, claimant B0 + response B0 return', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  claimL1(s, reg, 'PASS');
  const plan = finalizeClaim(s, { now: t0 + 5 + W1_ + 1 });
  assert.equal(plan.outcome, 'PASS');
  assert.equal(sum(plan, 'worker.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'bond-to-claimant'), bond1(A));       // appellant loses 2xB0
  assert.equal(sum(plan, 'worker.near', 'bond-return'), bond0(A) + bond0(A)); // L0 bond + response bond
  assert.equal(sum(plan, 'buyer.near', 'bond-return'), bond0(A));             // L1 bond back to its poster
  assert.equal(sum(plan, 'buyer.near', 'bond-slash-to-disputer'), 0n);
});

test('dispute overturned: claimant B0 + response B0 to appellant, FAIL refunds buyer', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  claimL1(s, reg, 'FAIL');
  const plan = finalizeClaim(s, { now: t0 + 5 + W1_ + 1 });
  assert.equal(plan.outcome, 'FAIL');
  assert.equal(sum(plan, 'buyer.near', 'escrow'), A);
  assert.equal(sum(plan, 'buyer.near', 'bond-slash-to-disputer'), bond1(A)); // 2xB0 moves to the winner
  assert.equal(sum(plan, 'buyer.near', 'bond-return'), bond1(A) + bond0(A)); // dispute bond back + L1 bond back
  assert.equal(sum(plan, 'worker.near'), 0n);
});

test('integrity void: fraudulent PASS claim slashed even though escrow refunds', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  claimL1(s, reg, 'FAIL', { integrityVoid: true });
  const plan = finalizeClaim(s, { now: t0 + 5 + W1_ + 1 });
  assert.equal(sum(plan, 'buyer.near', 'escrow'), A);
  assert.equal(sum(plan, 'buyer.near', 'bond-slash-to-disputer'), bond1(A));
  assert.equal(sum(plan, 'worker.near'), 0n);
});

test('default overturn: respondent never funds by claim time + W', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s);
  assert.throws(() => finalizeClaim(s, { now: L0_AT + W_ }), /response window still open/);
  const plan = finalizeClaim(s, { now: L0_AT + W_ + 1 });
  assert.equal(plan.outcome, 'FAIL');
  assert.equal(s.outcome, 'FAIL');
  assert.equal(s.defaulted, true);
  assert.equal(s.phase, 'Final');
  assert.equal(sum(plan, 'buyer.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'escrow'), 0n);
  assert.equal(sum(plan, 'buyer.near', 'bond-return'), bond1(A));
  assert.equal(sum(plan, 'buyer.near', 'bond-slash-to-disputer'), bond0(A));
  assert.equal(sum(plan, 'worker.near'), 0n);
});

test('default overturn of a FAIL claim pays the worker', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'FAIL', 'buyer.near');
  dispute(s, { by: 'worker.near', groundsHash: 'e'.repeat(64), bondPaid: bond1(A), now: t0 + 3 });
  const plan = finalizeClaim(s, { now: L0_AT + W_ + 1 });
  assert.equal(plan.outcome, 'PASS');
  assert.equal(s.defaulted, true);
  assert.equal(sum(plan, 'worker.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'bond-slash-to-disputer'), bond0(A));
  assert.equal(sum(plan, 'worker.near', 'bond-return'), bond1(A));
  assert.equal(sum(plan, 'buyer.near'), 0n);
});

test('appeal dismissed: funded but no L1 claim by claim time + W + W1', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  assert.throws(() => finalizeClaim(s, { now: L0_AT + W_ + 1 }), /appeal window still open/);
  assert.throws(() => finalizeClaim(s, { now: L0_AT + W_ + W1_ }), /appeal window still open/);
  const plan = finalizeClaim(s, { now: L0_AT + W_ + W1_ + 1 });
  assert.equal(plan.outcome, 'PASS');
  assert.equal(s.defaulted, undefined);
  assert.equal(sum(plan, 'worker.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'bond-to-claimant'), bond1(A));
  assert.equal(sum(plan, 'worker.near', 'bond-return'), bond0(A) + bond0(A)); // L0 bond + response bond
  assert.equal(sum(plan, 'buyer.near'), 0n);
});

test('invariant: once funded, exactly 2xB0 moves from loser to winner', () => {
  for (const l1 of ['PASS', 'FAIL']) {
    const s = base(); const reg = new Set();
    claimL0(s, reg, 'PASS', 'worker.near');
    openDispute(s); fund(s);
    claimL1(s, reg, l1);
    const plan = finalizeClaim(s, { now: t0 + 5 + W1_ + 1 });
    const bonds = (who) => plan.transfers.filter((t) => t.to === who && t.kind !== 'escrow').reduce((x, t) => x + t.amount, 0n);
    const workerNet = bonds('worker.near') - (bond0(A) + bond0(A)); // posted: L0 claim + response
    const buyerNet = bonds('buyer.near') - (bond1(A) + bond0(A));   // posted: appeal + L1 claim
    assert.equal(workerNet + buyerNet, 0n);
    assert.equal(l1 === 'PASS' ? workerNet : buyerNet, bond1(A));
  }
});

test('replay: the same req_hash cannot be claimed twice', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg);
  const s2 = base();
  assert.throws(() => claimL0(s2, reg), /replay/);
});

test('expiry: undelivered escrow refunds the buyer', () => {
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10, settleBy: t0 + 20 });
  const plan = expire(s, { now: t0 + 11 });
  assert.equal(plan.outcome, 'REFUND');
  assert.equal(sum(plan, 'buyer.near', 'escrow'), A);
});

test('window discipline: early finalize and late dispute both throw', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg);
  assert.throws(() => finalizeClaim(s, { now: t0 + 3 }), /window still open/);
  assert.throws(() => dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: bond1(A), now: t0 + 2 + 3_600_000 + 1 }), /window has closed/);
});
