// State machine main paths of the v7 profile (SPEC-v7-KERNEL §5.1, §5.2, §5.3, §8.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEAR, CLERK, FEES, R, S, X, T0, HOUR, W, HALF_W, W1,
  setup, createCase, submitCase, decide, appealCase, respondCase, decideAppeal, finalize, rejects,
} from './fixture.mjs';

const AMOUNT = 5n * NEAR;
const SUB_AT = T0 + HOUR;
const DEC_AT = T0 + 2 * HOUR;

function decidedCase(verdict, over = {}) {
  const { m } = setup();
  const id = createCase(m, over);
  const { k2, cap1 } = submitCase(m, id, SUB_AT);
  decide(m, id, verdict, DEC_AT);
  return { m, id, k2, cap1 };
}
const bal = (m, a) => m.balance(a);
const conserved = (m, id) => { const c = m.getCase(id); assert.equal(c.money.in, c.money.out, 'deposits == credits'); };

test('create -> submit -> PASS -> finalize with k2 inside the release window pays S and records k2', () => {
  const { m, id, k2 } = decidedCase('PASS');
  assert.equal(m.getCase(id).phase, 'Decided');
  // Not final until the appeal deadline (decision + W/2) has passed.
  rejects(assert, () => finalize(m, DEC_AT + HALF_W, id), 'E_NOT_FINAL');
  // Final: k2-less finalize is invalid while the release window is open.
  rejects(assert, () => finalize(m, DEC_AT + HALF_W + 1, id), 'E_K2_REQUIRED');
  rejects(assert, () => finalize(m, DEC_AT + HALF_W + 1, id, 'ab'.repeat(32)), 'E_K2_MISMATCH');
  const sBefore = bal(m, S);
  assert.equal(finalize(m, DEC_AT + HALF_W + 1, id, k2), 'PASS_RELEASED');
  const c = m.getCase(id);
  assert.equal(c.phase, 'Closed');
  assert.equal(c.k2, k2);
  assert.equal(c.finalAt, DEC_AT + HALF_W); // §5.2: no appeal -> final at the appeal deadline
  assert.equal(bal(m, S) - sBefore, AMOUNT);
  conserved(m, id);
  rejects(assert, () => finalize(m, DEC_AT + W, id), 'E_CLOSED');
});

test('time split (§5.3): k2 accepted at exactly finalAt + W/2, rejected one ms later', () => {
  {
    const { m, id, k2 } = decidedCase('PASS');
    assert.equal(finalize(m, DEC_AT + HALF_W + HALF_W, id, k2), 'PASS_RELEASED');
  }
  {
    const { m, id, k2 } = decidedCase('PASS');
    const late = DEC_AT + W + 1;
    rejects(assert, () => finalize(m, late, id, k2), 'E_K2_UNEXPECTED');
    // Exactly at the boundary the k2-less path is still closed.
    rejects(assert, () => finalize(m, DEC_AT + W, id), 'E_K2_REQUIRED');
    const rBefore = bal(m, R);
    assert.equal(finalize(m, late, id), 'PASS_UNRELEASED');
    assert.equal(bal(m, R) - rBefore, AMOUNT); // price back to R, nothing released
    assert.equal(m.getCase(id).k2, null);
    conserved(m, id);
  }
});

test('FAIL without appeal: anyone finalizes, price returns to R, k2 rejected', () => {
  const { m, id, k2 } = decidedCase('FAIL');
  rejects(assert, () => finalize(m, DEC_AT + HALF_W + 1, id, k2), 'E_K2_UNEXPECTED');
  const rBefore = bal(m, R);
  assert.equal(finalize(m, DEC_AT + HALF_W + 1, id), 'FAIL');
  assert.equal(bal(m, R) - rBefore, AMOUNT);
  assert.equal(m.getCase(id).k2, null);
  conserved(m, id);
});

test('appeal overturned (FAIL -> PASS): bonds move to the appellant, k2 finalize pays S', () => {
  const { m, id, k2 } = decidedCase('FAIL');
  const c0 = m.getCase(id);
  const bond = BigInt(c0.bond);
  // Only the disadvantaged side (S on FAIL) may appeal; R may not.
  rejects(assert, () => appealCase(m, id, R, DEC_AT + HOUR), 'E_NOT_APPELLANT');
  const capA = appealCase(m, id, S, DEC_AT + HOUR);
  rejects(assert, () => respondCase(m, id, S, DEC_AT + 2 * HOUR), 'E_NOT_RESPONDENT');
  respondCase(m, id, R, DEC_AT + 2 * HOUR);
  assert.equal(m.getCase(id).phase, 'UnderReview');
  const sBefore = bal(m, S), feesBefore = bal(m, FEES);
  const postAt = DEC_AT + 3 * HOUR;
  decideAppeal(m, id, 'PASS', postAt);
  const c1 = m.getCase(id);
  // CAP_A settles in the posting transaction: charge -> fee account, rest -> appellant.
  assert.equal(BigInt(c1.appeal.fee.charge) + BigInt(c1.appeal.fee.refund), capA);
  assert.equal(bal(m, FEES) - feesBefore, BigInt(c1.appeal.fee.charge));
  assert.equal(bal(m, S) - sBefore, BigInt(c1.appeal.fee.refund));
  // Final at the posting time (§5.2): finalize may run immediately, with k2.
  rejects(assert, () => finalize(m, postAt, id), 'E_K2_REQUIRED');
  const sMid = bal(m, S);
  assert.equal(finalize(m, postAt, id, k2), 'PASS_RELEASED');
  assert.equal(bal(m, S) - sMid, AMOUNT + 2n * bond);
  assert.equal(m.getCase(id).finalAt, postAt);
  conserved(m, id);
});

test('appeal upheld (FAIL stays): appellant bond moves to R, no k2', () => {
  const { m, id, k2 } = decidedCase('FAIL');
  const bond = BigInt(m.getCase(id).bond);
  appealCase(m, id, S, DEC_AT + HOUR);
  respondCase(m, id, R, DEC_AT + 2 * HOUR);
  decideAppeal(m, id, 'FAIL', DEC_AT + 3 * HOUR);
  rejects(assert, () => finalize(m, DEC_AT + 3 * HOUR, id, k2), 'E_K2_UNEXPECTED');
  const rBefore = bal(m, R), sBefore = bal(m, S);
  assert.equal(finalize(m, DEC_AT + 3 * HOUR, id), 'FAIL');
  assert.equal(bal(m, R) - rBefore, AMOUNT + 2n * bond);
  assert.equal(bal(m, S) - sBefore, 0n);
  conserved(m, id);
});

test('appeal by R against PASS, upheld: S keeps PASS and gains R\'s bond', () => {
  const { m, id, k2 } = decidedCase('PASS');
  const bond = BigInt(m.getCase(id).bond);
  rejects(assert, () => appealCase(m, id, S, DEC_AT + HOUR), 'E_NOT_APPELLANT');
  appealCase(m, id, R, DEC_AT + HOUR);
  respondCase(m, id, S, DEC_AT + 2 * HOUR);
  decideAppeal(m, id, 'PASS', DEC_AT + 3 * HOUR);
  const sBefore = bal(m, S);
  assert.equal(finalize(m, DEC_AT + 3 * HOUR + 1, id, k2), 'PASS_RELEASED');
  assert.equal(bal(m, S) - sBefore, AMOUNT + 2n * bond);
  conserved(m, id);
});

test('no response (default win): appeal against PASS -> FAIL final at the respond deadline; bond and full CAP_A return', () => {
  const { m, id, k2 } = decidedCase('PASS');
  const bond = BigInt(m.getCase(id).bond);
  const appealAt = DEC_AT + HOUR;
  const capA = appealCase(m, id, R, appealAt);
  rejects(assert, () => finalize(m, appealAt + HALF_W, id), 'E_NOT_FINAL');
  rejects(assert, () => respondCase(m, id, S, appealAt + HALF_W + 1), 'E_DEADLINE');
  rejects(assert, () => finalize(m, appealAt + HALF_W + 1, id, k2), 'E_K2_UNEXPECTED');
  const rBefore = bal(m, R), feesBefore = bal(m, FEES);
  assert.equal(finalize(m, appealAt + HALF_W + 1, id), 'FAIL');
  assert.equal(bal(m, R) - rBefore, AMOUNT + bond + capA);
  assert.equal(bal(m, FEES), feesBefore); // no review, no charge
  const c = m.getCase(id);
  assert.equal(c.finalAt, appealAt + HALF_W);
  assert.equal(c.appeal.fee.charge, '0');
  conserved(m, id);
});

test('no response (default win) for S: FAIL -> PASS, payment then needs k2 within finalAt + W/2', () => {
  const { m, id, k2 } = decidedCase('FAIL');
  const bond = BigInt(m.getCase(id).bond);
  const appealAt = DEC_AT + HOUR;
  const capA = appealCase(m, id, S, appealAt);
  const finalAt = appealAt + HALF_W;
  rejects(assert, () => finalize(m, finalAt + 1, id), 'E_K2_REQUIRED');
  const sBefore = bal(m, S);
  assert.equal(finalize(m, finalAt + HALF_W, id, k2), 'PASS_RELEASED');
  assert.equal(bal(m, S) - sBefore, AMOUNT + bond + capA);
  conserved(m, id);
});

test('clerk silence in review: primary stands, both bonds and the full CAP_A return', () => {
  const { m, id } = decidedCase('FAIL');
  const bond = BigInt(m.getCase(id).bond);
  const capA = appealCase(m, id, S, DEC_AT + HOUR);
  const respondAt = DEC_AT + 2 * HOUR;
  respondCase(m, id, R, respondAt);
  rejects(assert, () => decideAppeal(m, id, 'PASS', respondAt + W1 + 1), 'E_DEADLINE');
  rejects(assert, () => finalize(m, respondAt + W1, id), 'E_NOT_FINAL');
  const rBefore = bal(m, R), sBefore = bal(m, S), feesBefore = bal(m, FEES);
  assert.equal(finalize(m, respondAt + W1 + 1, id), 'FAIL');
  assert.equal(bal(m, R) - rBefore, AMOUNT + bond);
  assert.equal(bal(m, S) - sBefore, bond + capA);
  assert.equal(bal(m, FEES), feesBefore);
  assert.equal(m.getCase(id).finalAt, respondAt + W1);
  conserved(m, id);
});

test('clerk silence in review after a PASS primary: PASS stands, payment needs k2', () => {
  const { m, id, k2 } = decidedCase('PASS');
  appealCase(m, id, R, DEC_AT + HOUR);
  const respondAt = DEC_AT + 2 * HOUR;
  respondCase(m, id, S, respondAt);
  const finalAt = respondAt + W1;
  rejects(assert, () => finalize(m, finalAt + 1, id), 'E_K2_REQUIRED');
  assert.equal(finalize(m, finalAt + 1, id, k2), 'PASS_RELEASED');
  conserved(m, id);
});

test('unsubmitted expiry: after the submit deadline anyone finalizes, the price returns to R', () => {
  const { m } = setup();
  const id = createCase(m);
  const deadline = T0 + 3 * 86400 * 1000;
  rejects(assert, () => finalize(m, deadline, id), 'E_NOT_FINAL');
  rejects(assert, () => submitCase(m, id, deadline + 1), 'E_DEADLINE');
  rejects(assert, () => finalize(m, deadline + 1, id, 'ab'.repeat(32)), 'E_K2_UNEXPECTED');
  const rBefore = bal(m, R);
  assert.equal(finalize(m, deadline + 1, id), 'UNSUBMITTED');
  assert.equal(bal(m, R) - rBefore, AMOUNT);
  conserved(m, id);
});

test('submission at exactly the submit deadline is accepted', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, T0 + 3 * 86400 * 1000);
  assert.equal(m.getCase(id).phase, 'AwaitingDecision');
});

test('primary clerk silence (no decision): price to R, CAP_1 in full to S, late posting rejected', () => {
  const { m } = setup();
  const id = createCase(m);
  const { k2, cap1 } = submitCase(m, id, SUB_AT);
  rejects(assert, () => decide(m, id, 'PASS', SUB_AT + W1 + 1), 'E_DEADLINE');
  rejects(assert, () => finalize(m, SUB_AT + W1, id), 'E_NOT_FINAL');
  rejects(assert, () => finalize(m, SUB_AT + W1 + 1, id, k2), 'E_K2_UNEXPECTED');
  const rBefore = bal(m, R), sBefore = bal(m, S);
  assert.equal(finalize(m, SUB_AT + W1 + 1, id), 'NO_DECISION');
  assert.equal(bal(m, R) - rBefore, AMOUNT);
  assert.equal(bal(m, S) - sBefore, cap1);
  assert.equal(m.getCase(id).fee1.charge, '0');
  conserved(m, id);
});

test('decision posted at exactly submission + W1 is accepted', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'FAIL', SUB_AT + W1);
  assert.equal(m.getCase(id).phase, 'Decided');
});

test('role and phase guards', () => {
  const { m } = setup();
  const id = createCase(m);
  rejects(assert, () => decide(m, id, 'PASS', SUB_AT), 'E_PHASE');
  // Only the named submitter submits.
  const cap1 = BigInt(m.view('quote_fee', { case_id: id, kind: 'primary', sub_len: 4136 }));
  assert.ok(cap1 > 0n);
  rejects(assert, () => m.call('submit', { caller: X, now: SUB_AT, deposit: 1n }, { case_id: id }), 'E_NOT_SUBMITTER');
  submitCase(m, id, SUB_AT);
  rejects(assert, () => submitCase(m, id, SUB_AT), 'E_PHASE');
  // Only the pinned clerk posts.
  rejects(assert, () => m.call('post_decision', { caller: R, now: DEC_AT, deposit: 1n }, { case_id: id, verdict: 'PASS' }), 'E_NOT_CLERK');
  decide(m, id, 'FAIL', DEC_AT);
  rejects(assert, () => decide(m, id, 'PASS', DEC_AT), 'E_PHASE');
  // Appeal deadline is decision + W/2, inclusive.
  appealCase(m, id, S, DEC_AT + HALF_W);
  rejects(assert, () => appealCase(m, id, S, DEC_AT + HALF_W), 'E_PHASE'); // one appeal only
  // Only the clerk posts the appeal decision, and only once the respondent has bonded.
  rejects(assert, () => decideAppeal(m, id, 'PASS', DEC_AT + HALF_W + 1), 'E_PHASE');
});

test('appeal after decision + W/2 is rejected', () => {
  const { m, id } = decidedCase('FAIL');
  rejects(assert, () => appealCase(m, id, S, DEC_AT + HALF_W + 1), 'E_DEADLINE');
});

test('a failed call leaves no trace (atomic like a transaction)', () => {
  const { m, id } = decidedCase('FAIL');
  const before = JSON.stringify(m.getCase(id));
  const c = m.getCase(id);
  rejects(assert, () => m.call('appeal', { caller: S, now: DEC_AT + 1, deposit: BigInt(c.bond) }, { case_id: id }), 'E_DEPOSIT');
  assert.equal(JSON.stringify(m.getCase(id)), before);
});

test('zero-amount inspection case: PASS closes without payment and rejects k2; S\'s won appeal pays bonds without k2', () => {
  const { m } = setup();
  const id = createCase(m, { amount: '0' });
  const { k2 } = submitCase(m, id, SUB_AT);
  decide(m, id, 'FAIL', DEC_AT);
  const bond = BigInt(m.getCase(id).bond);
  appealCase(m, id, S, DEC_AT + HOUR);
  respondCase(m, id, R, DEC_AT + 2 * HOUR);
  decideAppeal(m, id, 'PASS', DEC_AT + 3 * HOUR);
  rejects(assert, () => finalize(m, DEC_AT + 3 * HOUR, id, k2), 'E_K2_UNEXPECTED');
  const sBefore = bal(m, S);
  assert.equal(finalize(m, DEC_AT + 3 * HOUR, id), 'PASS');
  assert.equal(bal(m, S) - sBefore, 2n * bond);
  assert.equal(m.getCase(id).k2, null);
  conserved(m, id);
});

test('withdraw moves the internal balance out, and only the caller\'s own', () => {
  const { m, id, k2 } = decidedCase('PASS');
  finalize(m, DEC_AT + HALF_W + 1, id, k2);
  const b = bal(m, S);
  rejects(assert, () => m.call('withdraw', { caller: S, now: DEC_AT + W }, { amount: (b + 1n).toString() }), 'E_BALANCE');
  m.call('withdraw', { caller: S, now: DEC_AT + W }, { amount: '1' });
  assert.equal(bal(m, S), b - 1n);
  m.call('withdraw', { caller: S, now: DEC_AT + W }, {});
  assert.equal(bal(m, S), 0n);
  assert.deepEqual(m.transfers.map((t) => [t.to, t.amount]), [[S, 1n], [S, b - 1n]]);
  rejects(assert, () => m.call('withdraw', { caller: S, now: DEC_AT + W }, {}), 'E_BALANCE');
  rejects(assert, () => m.call('withdraw', { caller: CLERK, now: DEC_AT + W, deposit: 1n }, {}), 'E_DEPOSIT');
});
