// The offline end-to-end demo runs and reaches the expected endings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDemo } from '../clerk/demo.mjs';

test('offline demo: registration, PASS release, appeal overturn, formal PASS', async () => {
  const s = await runDemo({ log: () => {} });
  assert.equal(s.register1.clerk, 'registered');
  assert.equal(s.register2.clerk, 'unchanged');
  assert.equal(s.pass.ending, 'PASS_RELEASED');
  assert.equal(s.pass.requesterDecrypted,'# Deliverables\nReport on five competitors. Section 4: price table.');
  assert.ok(s.pass.reason.length > 0);
  assert.deepEqual([s.appeal.primary, s.appeal.result, s.appeal.ending], ['FAIL', 'PASS', 'PASS_RELEASED']);
  assert.equal(s.appeal.usage.panel.length, 3);
  assert.equal(s.appeal.usage.comparison.length, 1);
  assert.deepEqual([s.formal.verdict, s.formal.usage, s.formal.modelCalls], ['PASS', [], 0]);
});
