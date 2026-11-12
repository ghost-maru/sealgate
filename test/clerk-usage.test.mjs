// Declared usage: per call, input and output each rounded UP to 1,024-token
// units (SPEC §6.1 settlement step 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { roundUpTokens, declareUsage, USAGE_UNIT } from '../clerk/usage.mjs';
import { usageCall } from '../contract/src/kernel/judgment.js';

test('rounding up to 1024-token units', () => {
  assert.equal(USAGE_UNIT, 1024);
  assert.equal(roundUpTokens(0), 0);
  assert.equal(roundUpTokens(1), 1024);
  assert.equal(roundUpTokens(1023), 1024);
  assert.equal(roundUpTokens(1024), 1024);
  assert.equal(roundUpTokens(1025), 2048);
  assert.equal(roundUpTokens(16385), 17408);
});

test('the spec example: input 3,100 / output 412 declares 4,096 / 1,024', () => {
  assert.deepEqual(declareUsage({ in: 3100, out: 412 }), { in: 4096, out: 1024 });
});

test('invalid token counts are refused', () => {
  for (const bad of [-1, 1.5, NaN, Infinity, '12', null]) assert.throws(() => roundUpTokens(bad));
});

test('declared usage is accepted by the contract argument check', () => {
  for (const u of [{ in: 0, out: 0 }, { in: 3100, out: 412 }, { in: 9999, out: 1 }]) {
    const d = declareUsage(u);
    assert.deepEqual(usageCall(d, 'u'), d);
  }
  assert.throws(() => usageCall({ in: 3100, out: 412 }, 'u'), /E_USAGE_UNIT/); // unrounded values are rejected on-chain
});
