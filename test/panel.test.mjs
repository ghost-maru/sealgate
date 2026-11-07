import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePanel } from '../cli/appellate.mjs';

const S = (verdict) => ({ ok: true, verdict });
const BAD = { ok: false };

test('panel: unanimous and majority verdicts', () => {
  assert.equal(decidePanel([S('PASS'), S('PASS'), S('PASS')], 'FAIL').verdict, 'PASS');
  assert.equal(decidePanel([S('FAIL'), S('FAIL'), S('FAIL')], 'PASS').verdict, 'FAIL');
  assert.equal(decidePanel([S('PASS'), S('FAIL'), S('PASS')], 'FAIL').verdict, 'PASS');
  assert.equal(decidePanel([S('FAIL'), S('PASS'), S('FAIL')], 'PASS').verdict, 'FAIL');
});

test('panel: chosen sample is the first one agreeing with the majority', () => {
  const d = decidePanel([S('FAIL'), S('PASS'), S('PASS')], 'FAIL');
  assert.equal(d.chosenIndex, 1);
  const d2 = decidePanel([S('PASS'), S('FAIL'), S('FAIL')], 'PASS');
  assert.equal(d2.chosenIndex, 1);
});

test('panel: unparseable samples abstain; quorum is 2 valid', () => {
  const d = decidePanel([BAD, S('PASS'), S('PASS')], 'FAIL');
  assert.equal(d.verdict, 'PASS');
  assert.equal(d.validCount, 2);
  assert.equal(decidePanel([BAD, BAD, S('PASS')], 'PASS'), null);
  assert.equal(decidePanel([BAD, BAD, BAD], 'PASS'), null);
});

test('panel: a 1-1 split resolves to the L0 verdict (a split panel is not clear error)', () => {
  assert.equal(decidePanel([BAD, S('PASS'), S('FAIL')], 'PASS').verdict, 'PASS');
  assert.equal(decidePanel([BAD, S('PASS'), S('FAIL')], 'FAIL').verdict, 'FAIL');
  assert.equal(decidePanel([BAD, S('PASS'), S('FAIL')], 'PASS').chosenIndex, 1);
});
