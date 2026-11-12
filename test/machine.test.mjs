import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR, createEscrow, submitDeliverable, postClaim, dispute, respondDispute, coSign, finalizeClaim, expire, bond0, bond1, registerKey, ackBundle, claimJob, defaultTerms, bondOf, prune, CREATE_STORAGE, RECORD_RENT, PRUNE_DELAY_MS, storageChargeFor } from '../contract/machine.mjs';

const A = NEAR; // 1 NEAR escrow
const t0 = 1_000_000_000;
const base = () => {
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000, executor: 'executor.near', executorKey: '9'.repeat(64), buyerKey: 'a'.repeat(64), workerKey: 'b'.repeat(64) });
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now: t0 + 1 });
  return s;
};
const claimL0 = (s, reg, verdict = 'PASS', by = 'worker.near') =>
  postClaim(s, { by, level: 0, verdict, reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bond0(A), now: t0 + 2, escrowKey: 'x' }, reg);
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
  postClaim(s, { by: 'executor.near', executor: 'executor.near', level: 1, verdict, reqHash: 'f'.repeat(64), respHash: '1'.repeat(64), bondPaid: 0n, now: t0 + 5, escrowKey: 'x', ...extra }, reg);

test('dispute: appellant must post 2xB0 and dispute within W/2', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  assert.throws(() => dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: bond0(A), now: t0 + 3 }), /exactly/);
  // Exact bonds (v4 review S2): an overpayment is rejected too — it used to
  // be silently slashable at the overpaid amount.
  assert.throws(() => dispute(s, { by: 'buyer.near', groundsHash: 'e'.repeat(64), bondPaid: bond1(A) + 1n, now: t0 + 3 }), /exactly/);
  assert.throws(() => openDispute(s, L0_AT + W_ / 2 + 1), /W\/2/);
  const d = openDispute(s, L0_AT + W_ / 2); // boundary is inclusive
  assert.equal(d.funded, false);
  assert.equal(d.respondentBond, 0n);
  assert.equal(s.phase, 'Disputed');
});

test('respondDispute: only the L0 claimant, exactly B0, by claim time + W, once', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s);
  assert.throws(() => respondDispute(s, { by: 'buyer.near', bondPaid: bond0(A), now: t0 + 4 }), /only the L0 claimant/);
  assert.throws(() => respondDispute(s, { by: 'worker.near', bondPaid: bond0(A) - 1n, now: t0 + 4 }), /exactly/);
  assert.throws(() => respondDispute(s, { by: 'worker.near', bondPaid: bond0(A) + 1n, now: t0 + 4 }), /exactly/);
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

test('L1 claim: no bond (executor), deadline is funding time + W1', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s); // fundedAt = t0 + 4
  assert.throws(() => claimL1(s, reg, 'FAIL', { now: t0 + 4 + W1_ + 1 }), /not prosecuted/);
  claimL1(s, reg, 'FAIL', { now: t0 + 4 + W1_ });
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
  assert.equal(sum(plan, 'executor.near', 'bond-return'), 0n);                 // executor posts no bond
  assert.equal(sum(plan, 'buyer.near', 'bond-return'), 0n);
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
  assert.equal(sum(plan, 'buyer.near', 'bond-return'), bond1(A));            // dispute bond back
  assert.equal(sum(plan, 'executor.near', 'bond-return'), 0n);               // executor posts no bond
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

test('appeal lapsed after executor ack: executor silence moves no bonds (N3)', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s); // fundedAt = t0 + 4
  ackBundle(s, { by: 'executor.near', now: t0 + 5 });
  const FUNDED_AT = t0 + 4;
  assert.throws(() => finalizeClaim(s, { now: FUNDED_AT + W1_ }), /appeal window still open/);
  const plan = finalizeClaim(s, { now: FUNDED_AT + W1_ + 1 });
  assert.equal(plan.outcome, 'PASS');
  assert.equal(s.defaulted, undefined);
  assert.equal(sum(plan, 'worker.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'bond-to-claimant'), 0n);               // acked lapse: no bond moves between parties
  assert.equal(sum(plan, 'worker.near', 'bond-return'), bond0(A) + bond0(A)); // L0 bond + response bond
  assert.equal(sum(plan, 'buyer.near', 'bond-return'), bond1(A));               // dispute funding returns to the appellant
  assert.equal(sum(plan, 'buyer.near'), bond1(A));
});

test('appeal lapsed with no ack: the appellant did not prosecute and pays 2xB0 (N3)', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  const plan = finalizeClaim(s, { now: t0 + 4 + W1_ + 1 });
  assert.equal(plan.outcome, 'PASS');
  assert.equal(sum(plan, 'worker.near', 'escrow'), A);
  assert.equal(sum(plan, 'worker.near', 'bond-to-claimant'), bond1(A));          // appellant's 2xB0 to the claimant
  assert.equal(sum(plan, 'worker.near', 'bond-return'), bond0(A) + bond0(A));  // L0 bond + response bond return
  assert.equal(sum(plan, 'buyer.near'), 0n);                                      // the free-option appeal is closed
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
    const buyerNet = bonds('buyer.near') - bond1(A);                // posted: appeal funding only
    const executorNet = bonds('executor.near');                     // executor posts no bond and receives none
    assert.equal(executorNet, 0n);
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
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10, settleBy: t0 + 100_000_000, executor: 'executor.near' });
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

test('L1 race closed: only the registered appellate executor may post an L1 claim', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s);
  const attempt = (by, extra = {}) => () => postClaim(s, { by, level: 1, verdict: 'FAIL', reqHash: '9'.repeat(64), respHash: '8'.repeat(64), bondPaid: 0n, now: t0 + 5, escrowKey: 'x', ...extra }, reg);
  assert.throws(attempt('worker.near', { executor: 'executor.near' }), /appellate executor/);
  assert.throws(attempt('buyer.near', { executor: 'executor.near' }), /appellate executor/);
  assert.throws(attempt('executor.near'), /no appellate executor registered/);
  claimL1(s, reg, 'FAIL'); // the executor can
  assert.equal(s.phase, 'Claimed');
});

test('replay registry is scoped per escrow (F2): the same req_hash in another escrow is fine', () => {
  const reg = new Set();
  const s1 = base();
  postClaim(s1, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bond0(A), now: t0 + 2, escrowKey: 'one' }, reg);
  const s2 = base();
  postClaim(s2, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bond0(A), now: t0 + 2, escrowKey: 'two' }, reg);
  assert.equal(s2.phase, 'Claimed');
});

test('createEscrow rejects settle_by <= deliver_by; L0 claim after settle_by fails', () => {
  assert.throws(() => createEscrow({ buyer: 'b.near', worker: 'w.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10, settleBy: t0 + 10, executor: 'executor.near' }), /settle_by/);
  const s = base(); const reg = new Set();
  assert.throws(() => postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bond0(A), now: t0 + 100_000_001, escrowKey: 'x' }, reg), /settle_by/);
});

test('L0 claim requires both parties response keys (N1)', () => {
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000, executor: 'executor.near' });
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now: t0 + 1 });
  const reg = new Set();
  assert.throws(() => claimL0(s, reg), /register response keys/);
  registerKey(s, { by: 'buyer.near', pubkey: 'a'.repeat(64) });
  assert.throws(() => claimL0(s, reg), /register response keys/);
  assert.throws(() => registerKey(s, { by: 'buyer.near', pubkey: 'c'.repeat(64) }), /already registered/);
  registerKey(s, { by: 'worker.near', pubkey: 'b'.repeat(64) });
  claimL0(s, reg);
  assert.equal(s.phase, 'Claimed');
});

test('ack: only the snapshotted executor, only on a funded dispute (N3/N4)', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s);
  ackBundle(s, { by: 'executor.near', now: t0 + 4 }); // pre-funding ack records bundle receipt (R4)
  assert.equal(s.dispute.acked, true);
  fund(s);
  assert.throws(() => ackBundle(s, { by: 'buyer.near', now: t0 + 5 }), /snapshotted appellate executor/);
  ackBundle(s, { by: 'executor.near', now: t0 + 5 });
  assert.equal(s.dispute.acked, true);
});

test('createEscrow: executor required, not a party, window must fit W + W1 (N4/F10)', () => {
  const mk = (extra) => () => createEscrow({ buyer: 'b.near', worker: 'w.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10, settleBy: t0 + 100_000_000, ...extra });
  assert.throws(mk({}), /executor must be registered/);
  assert.throws(mk({ executor: 'b.near' }), /must not be a party/);
  assert.throws(() => createEscrow({ buyer: 'b.near', worker: 'w.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10, settleBy: t0 + 10 + 3_600_000, executor: 'executor.near' }), /window too short/);
});

test('L1 deadline runs from funding time, not claim time (N5)', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s);
  fund(s, L0_AT + W_); // respondent funds at the last allowed moment
  // L1 at fundedAt + W1 is still in time even though it is past claim + W + W1 - something
  claimL1(s, reg, 'FAIL', { now: L0_AT + W_ + W1_ });
  assert.equal(s.phase, 'Claimed');
});

test('ack deadline: no ack in the second half of the L1 window (R2)', () => {
  const s = base(); const reg = new Set();
  claimL0(s, reg, 'PASS', 'worker.near');
  openDispute(s); fund(s); // fundedAt = t0 + 4
  assert.throws(() => ackBundle(s, { by: 'executor.near', now: t0 + 4 + W1_ / 2 + 1 }), /ack deadline/);
  ackBundle(s, { by: 'executor.near', now: t0 + 4 + W1_ / 2 }); // boundary is inclusive
  assert.equal(s.dispute.acked, true);
});

test('submitDeliverable requires the on-chain encrypted deliverable (R1)', () => {
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000, executor: 'executor.near', salted: true });
  assert.equal(s.salted, true);
  assert.throws(() => submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), now: t0 + 1 }), /encrypted deliverable is required/);
  assert.throws(() => submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'x'.repeat(16385), now: t0 + 1 }), /too large/);
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now: t0 + 1 });
  assert.equal(s.deliverableCipher, 'cipher');
});

test('v3: open job lifecycle — claim anchors the windows, unclaimed expiry refunds in full', () => {
  const SINK = 'sink.near';
  const open1 = () => createEscrow({ buyer: 'buyer.near', open: true, amount: A, criteriaHash: 'c'.repeat(64), claimBy: t0 + 500, deliverWindow: 1000, settleWindow: 100_000_000, executor: 'executor.near', feeSink: SINK });
  const s = open1();
  assert.equal(s.worker, null);
  assert.throws(() => claimJob(s, { by: 'buyer.near', now: t0 + 1 }), /buyer cannot claim/);
  assert.throws(() => claimJob(s, { by: 'executor.near', now: t0 + 1 }), /executor cannot claim/);
  assert.throws(() => claimJob(s, { by: 'worker.near', now: t0 + 501 }), /claim deadline/);
  // M2: without the buyer's registered key, claiming is refused.
  const s0 = open1();
  assert.throws(() => claimJob(s0, { by: 'worker.near', now: t0 + 1 }), /buyer has not registered/);
  registerKey(s, { by: 'buyer.near', pubkey: 'a'.repeat(64) });
  claimJob(s, { by: 'worker.near', now: t0 + 400 });
  assert.equal(s.worker, 'worker.near');
  assert.equal(s.deliverBy, t0 + 1400);
  assert.equal(s.settleBy, t0 + 1400 + 100_000_000);
  assert.throws(() => claimJob(s, { by: 'other.near', now: t0 + 401 }), /not an unclaimed open job/);
  // Unclaimed expiry: full refund, NO fee even with a sink snapshotted.
  // Claim and expiry are disjoint at the boundary: claim at claimBy works,
  // expiry needs claimBy + 1.
  const sb = open1();
  registerKey(sb, { by: 'buyer.near', pubkey: 'a'.repeat(64) });
  assert.throws(() => expire(sb, { now: t0 + 500 }), /nothing expirable/);
  claimJob(sb, { by: 'worker.near', now: t0 + 500 });
  const s2 = open1();
  const plan = expire(s2, { now: t0 + 501 });
  assert.equal(plan.transfers.length, 1);
  assert.equal(plan.transfers[0].amount, A);
  assert.equal(plan.transfers[0].kind, 'escrow');
});

test('v3: platform fee — 1% of the amount to the sink on judgment settlements only', () => {
  const SINK = 'sink.near';
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000, executor: 'executor.near', feeSink: SINK });
  registerKey(s, { by: 'buyer.near', pubkey: 'a'.repeat(64) });
  registerKey(s, { by: 'worker.near', pubkey: 'b'.repeat(64) });
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now: t0 + 1 });
  const reg = new Set();
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: '1'.repeat(64), respHash: '2'.repeat(64), bondPaid: bond0(A), now: t0 + 2, executor: 'executor.near', escrowKey: 'T' }, reg);
  const plan = finalizeClaim(s, { now: t0 + 2 + W1_ + W_ + 1 });
  const esc = plan.transfers.find((t) => t.kind === 'escrow');
  const fee = plan.transfers.find((t) => t.kind === 'fee');
  assert.equal(esc.to, 'worker.near');
  assert.equal(esc.amount, A - A / 100n);
  assert.equal(fee.to, SINK);
  assert.equal(fee.amount, A / 100n);
  // Legacy escrow without a sink: no fee transfer, amount paid in full.
  const s2 = base();
  claimL0(s2, new Set(), 'PASS', 'worker.near');
  const plan2 = finalizeClaim(s2, { now: t0 + 100_000_000 });
  assert.equal(plan2.transfers.find((t) => t.kind === 'escrow').amount, A);
  assert.equal(plan2.transfers.some((t) => t.kind === 'fee'), false);
});

// --- v5 storage economics (production-plan constraint A) ---
const v2escrow = () => {
  const terms = defaultTerms({ feeSink: 'platform.near', feeBps: 100 });
  const s = createEscrow({ buyer: 'buyer.near', worker: 'worker.near', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 10_000, settleBy: t0 + 100_000_000, executor: 'executor.near', executorKey: '9'.repeat(64), buyerKey: 'a'.repeat(64), workerKey: 'b'.repeat(64), terms, now: t0, storagePaid: CREATE_STORAGE });
  return { s, terms };
};

test('v5 storage: create requires the exact CREATE_STORAGE deposit on v2, none on legacy', () => {
  const terms = defaultTerms({ feeSink: 'platform.near', feeBps: 100 });
  const mk = (storagePaid) => () => createEscrow({ buyer: 'b', worker: 'w', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 100_000_000, executor: 'e', terms, now: t0, storagePaid });
  assert.throws(mk(0n), /CREATE_STORAGE/);
  assert.throws(mk(CREATE_STORAGE - 1n), /CREATE_STORAGE/);
  assert.throws(mk(CREATE_STORAGE + 1n), /CREATE_STORAGE/);
  assert.doesNotThrow(mk(CREATE_STORAGE));
  assert.throws(() => createEscrow({ buyer: 'b', worker: 'w', amount: A, criteriaHash: 'c'.repeat(64), deliverBy: t0 + 1, settleBy: t0 + 100_000_000, executor: 'e', storagePaid: 1n }), /legacy-generation/);
});

test('v5 storage: deliverable and response charges are per-byte exact', () => {
  const { s, terms } = v2escrow();
  const cipher = 'x'.repeat(2048);
  assert.throws(() => submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: cipher, now: t0 + 1, storagePaid: storageChargeFor(2048) - 1n }), /per-byte/);
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: cipher, now: t0 + 1, storagePaid: storageChargeFor(2048) });
  assert.equal(s.deliverableStorage, storageChargeFor(2048));
  const reg = new Set();
  const b0 = bondOf(terms, A);
  assert.throws(() => postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: b0, now: t0 + 2, escrowKey: 'x', responseBytes: 1400, storagePaid: 0n }, reg), /per-byte/);
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: b0, now: t0 + 2, escrowKey: 'x', responseBytes: 1400, storagePaid: storageChargeFor(1400) }, reg);
  assert.equal(s.claims[0].storagePaid, storageChargeFor(1400));
});

test('v5 prune: both-party consent executes; refunds are exact and the rent is retained', () => {
  const { s, terms } = v2escrow();
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'x'.repeat(2048), now: t0 + 1, storagePaid: storageChargeFor(2048) });
  const reg = new Set();
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'PASS', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bondOf(terms, A), now: t0 + 2, escrowKey: 'x', responseBytes: 1400, storagePaid: storageChargeFor(1400) }, reg);
  assert.throws(() => prune(s, { by: 'buyer.near', now: t0 + 3 }), /cannot prune in phase/);
  coSign(s, { by: 'buyer.near', now: t0 + 3 });
  assert.equal(s.phase, 'Final');
  const r1 = prune(s, { by: 'buyer.near', now: t0 + 4 });
  assert.equal(r1.executed, false); // one consent is not enough, and the delay has not run
  const r2 = prune(s, { by: 'worker.near', now: t0 + 5 });
  assert.equal(r2.executed, true);
  assert.equal(sum(r2, 'worker.near', 'storage-refund'), storageChargeFor(2048) + storageChargeFor(1400)); // deliverable + own claim response
  assert.equal(sum(r2, 'buyer.near', 'storage-refund'), CREATE_STORAGE - RECORD_RENT);
  assert.equal(r2.retained, RECORD_RENT);
  assert.equal(s.pruned, true);
  assert.equal(s.deliverableCipher, null);
  assert.throws(() => prune(s, { by: 'buyer.near', now: t0 + 6 }), /already pruned/);
});

test('v5 prune: after the retention delay anyone may execute; before it a stranger cannot', () => {
  const { s, terms } = v2escrow();
  submitDeliverable(s, { by: 'worker.near', deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now: t0 + 1, storagePaid: storageChargeFor(6) });
  const reg = new Set();
  postClaim(s, { by: 'worker.near', level: 0, verdict: 'FAIL', reqHash: 'a'.repeat(64), respHash: 'b'.repeat(64), bondPaid: bondOf(terms, A), now: t0 + 2, escrowKey: 'x' }, reg);
  const fin = t0 + 3_600_010; // past windowEnds (claim at t0+2, W = 1h)
  finalizeClaim(s, { now: fin });
  assert.equal(s.finalAt, fin);
  const early = prune(s, { by: 'stranger.near', now: fin + PRUNE_DELAY_MS - 1 });
  assert.equal(early.executed, false);
  const late = prune(s, { by: 'stranger.near', now: fin + PRUNE_DELAY_MS });
  assert.equal(late.executed, true);
  assert.equal(sum(late, 'buyer.near', 'storage-refund'), CREATE_STORAGE - RECORD_RENT);
});

test('v5 prune: an expired unclaimed open job needs only the buyer; a legacy escrow refunds nothing', () => {
  const terms = defaultTerms({ feeSink: 'platform.near', feeBps: 100 });
  const s = createEscrow({ buyer: 'buyer.near', open: true, amount: A, criteriaHash: 'c'.repeat(64), claimBy: t0 + 500, deliverWindow: 1000, settleWindow: 100_000_000, executor: 'executor.near', feeSink: 'platform.near', terms, now: t0, storagePaid: CREATE_STORAGE });
  expire(s, { now: t0 + 501 });
  const r = prune(s, { by: 'buyer.near', now: t0 + 502 });
  assert.equal(r.executed, true);
  assert.equal(sum(r, 'buyer.near', 'storage-refund'), CREATE_STORAGE - RECORD_RENT);
  assert.equal(r.retained, RECORD_RENT);
  // legacy (generation 1): no storage was ever paid; pruning is free and refunds 0
  const l = base();
  claimL0(l, new Set());
  coSign(l, { by: 'buyer.near', now: t0 + 3 });
  const rl = prune(l, { by: 'worker.near', now: t0 + 4 });
  assert.equal(rl.executed, false);
  const rl2 = prune(l, { by: 'buyer.near', now: t0 + 5 });
  assert.equal(rl2.executed, true);
  assert.equal(rl2.transfers.length, 0);
  assert.equal(rl2.retained, 0n);
});
