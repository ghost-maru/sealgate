// The single k2 rule (SPEC-v7-KERNEL §5.4): finalize accepts k2 only when that
// finalize pays a positive amount to the submitter (and then requires it);
// every other call rejects a supplied k2 with E_K2_UNEXPECTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METHODS } from '../contract/machine.mjs';
import {
  OWNER, CLERK, R, S, X, T0, HOUR, W, HALF_W, W1,
  setup, createCase, submitCase, decide, appealCase, respondCase, decideAppeal, finalize, rejects,
} from './fixture.mjs';

const SUB_AT = T0 + HOUR;
const DEC_AT = T0 + 2 * HOUR;
const BOGUS_K2 = 'cd'.repeat(32);

test('every call method other than finalize rejects a supplied k2, whatever else is wrong', () => {
  const { m } = setup();
  const id = createCase(m);
  const callers = [OWNER, CLERK, R, S, X];
  for (const [name, def] of Object.entries(METHODS)) {
    if (def.kind !== 'call' || name === 'finalize') continue;
    for (const caller of callers) {
      rejects(assert, () => m.call(name, { caller, now: SUB_AT, deposit: 0n }, { case_id: id, k2: BOGUS_K2 }), 'E_K2_UNEXPECTED');
    }
  }
});

// Each scenario: build a case to a closable point, then check finalize at
// `at`. `pays` = the finalize pays the price to S (k2 required and accepted).
const scenarios = [
  { name: 'PASS, amount > 0, inside release window', pays: true, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); return { id, k2, at: DEC_AT + HALF_W + 1 }; } },
  { name: 'PASS, amount > 0, after release window (unreleased)', pays: false, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); return { id, k2, at: DEC_AT + W + 1 }; } },
  { name: 'FAIL, amount > 0', pays: false, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'FAIL', DEC_AT); return { id, k2, at: DEC_AT + HALF_W + 1 }; } },
  { name: 'no decision (clerk silent)', pays: false, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); return { id, k2, at: SUB_AT + W1 + 1 }; } },
  { name: 'unsubmitted', pays: false, build: (m) => { const id = createCase(m); return { id, k2: BOGUS_K2, at: T0 + 3 * 86400 * 1000 + 1 }; } },
  { name: 'PASS, amount 0 (inspection)', pays: false, build: (m) => { const id = createCase(m, { amount: '0' }); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); return { id, k2, at: DEC_AT + HALF_W + 1 }; } },
  { name: 'PASS, amount 0 (adjudication)', pays: false, build: (m) => { const id = createCase(m, { amount: '0', template_id: 'adjudication' }); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); return { id, k2, at: DEC_AT + HALF_W + 1 }; } },
  { name: 'FAIL, amount 0 (adjudication)', pays: false, build: (m) => { const id = createCase(m, { amount: '0', template_id: 'adjudication' }); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'FAIL', DEC_AT); return { id, k2, at: DEC_AT + HALF_W + 1 }; } },
  { name: 'appeal overturned to PASS, amount > 0', pays: true, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'FAIL', DEC_AT); appealCase(m, id, S, DEC_AT + 1); respondCase(m, id, R, DEC_AT + 2); decideAppeal(m, id, 'PASS', DEC_AT + 3); return { id, k2, at: DEC_AT + 3 }; } },
  { name: 'appeal overturned to FAIL, amount > 0', pays: false, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); appealCase(m, id, R, DEC_AT + 1); respondCase(m, id, S, DEC_AT + 2); decideAppeal(m, id, 'FAIL', DEC_AT + 3); return { id, k2, at: DEC_AT + 3 }; } },
  { name: 'default win to PASS, amount > 0', pays: true, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'FAIL', DEC_AT); appealCase(m, id, S, DEC_AT + 1); return { id, k2, at: DEC_AT + 1 + HALF_W + 1 }; } },
  { name: 'default win to FAIL, amount > 0', pays: false, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); appealCase(m, id, R, DEC_AT + 1); return { id, k2, at: DEC_AT + 1 + HALF_W + 1 }; } },
  { name: 'review silence, PASS stands, amount > 0', pays: true, build: (m) => { const id = createCase(m); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'PASS', DEC_AT); appealCase(m, id, R, DEC_AT + 1); respondCase(m, id, S, DEC_AT + 2); return { id, k2, at: DEC_AT + 2 + W1 + 1 }; } },
  { name: 'appeal overturned to PASS, amount 0 (S receives bonds only)', pays: false, build: (m) => { const id = createCase(m, { amount: '0' }); const { k2 } = submitCase(m, id, SUB_AT); decide(m, id, 'FAIL', DEC_AT); appealCase(m, id, S, DEC_AT + 1); respondCase(m, id, R, DEC_AT + 2); decideAppeal(m, id, 'PASS', DEC_AT + 3); return { id, k2, at: DEC_AT + 3 }; } },
];

for (const sc of scenarios) {
  test(`finalize k2 rule: ${sc.name} -> ${sc.pays ? 'k2 required and accepted' : 'k2 rejected'}`, () => {
    const { m } = setup();
    const { id, k2, at } = sc.build(m);
    if (sc.pays) {
      rejects(assert, () => finalize(m, at, id), 'E_K2_REQUIRED');
      rejects(assert, () => finalize(m, at, id, BOGUS_K2), 'E_K2_MISMATCH');
      finalize(m, at, id, k2);
      assert.equal(m.getCase(id).k2, k2);
      assert.equal(m.getCase(id).ending, 'PASS_RELEASED');
    } else {
      rejects(assert, () => finalize(m, at, id, k2), 'E_K2_UNEXPECTED');
      finalize(m, at, id);
      assert.equal(m.getCase(id).k2, null);
    }
  });
}

test('k2 before finality is rejected as unexpected (a non-paying finalize), in every open phase', () => {
  const { m } = setup();
  const id = createCase(m);
  rejects(assert, () => finalize(m, SUB_AT, id, BOGUS_K2), 'E_K2_UNEXPECTED');           // AwaitingSubmission
  const { k2 } = submitCase(m, id, SUB_AT);
  rejects(assert, () => finalize(m, SUB_AT + 1, id, k2), 'E_K2_UNEXPECTED');             // AwaitingDecision
  decide(m, id, 'PASS', DEC_AT);
  rejects(assert, () => finalize(m, DEC_AT + HALF_W, id, k2), 'E_K2_UNEXPECTED');        // Decided, appeal window open
  appealCase(m, id, R, DEC_AT + 1);
  rejects(assert, () => finalize(m, DEC_AT + 2, id, k2), 'E_K2_UNEXPECTED');             // Appealed
  respondCase(m, id, S, DEC_AT + 2);
  rejects(assert, () => finalize(m, DEC_AT + 3, id, k2), 'E_K2_UNEXPECTED');             // UnderReview
  decideAppeal(m, id, 'PASS', DEC_AT + 4);
  finalize(m, DEC_AT + 4, id, k2);
  rejects(assert, () => finalize(m, DEC_AT + 5, id, k2), 'E_K2_UNEXPECTED');             // Closed
  assert.equal(m.getCase(id).phase, 'Closed');
});

test('anyone holding the right k2 may release (no caller check on the paying finalize)', () => {
  const { m } = setup();
  const id = createCase(m);
  const { k2 } = submitCase(m, id, SUB_AT);
  decide(m, id, 'PASS', DEC_AT);
  finalize(m, DEC_AT + HALF_W + 1, id, k2, X);
  assert.equal(m.getCase(id).ending, 'PASS_RELEASED');
});

test('a malformed k2 on a paying finalize is rejected without releasing', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'PASS', DEC_AT);
  rejects(assert, () => finalize(m, DEC_AT + HALF_W + 1, id, 'XYZ'), 'E_ARG');
  assert.equal(m.getCase(id).k2, null);
});
