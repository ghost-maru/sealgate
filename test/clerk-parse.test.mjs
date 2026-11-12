// Response parsing per SPEC §8.2 rules 1-7 and the comparison schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdictResponse, parseComparisonResponse, signedUsage } from '../shared/response.mjs';
import { chatResponseBytes } from '../clerk/mock-ai.mjs';

const resp = (content, { finish = 'stop', usage = { prompt_tokens: 10, completion_tokens: 5 } } = {}) =>
  chatResponseBytes({ id: 'x', model: 'm', content, finishReason: finish, usage });
const J = (o) => JSON.stringify(o);
const raw = (s) => new TextEncoder().encode(s);

test('verdict: valid responses are accepted', () => {
  let p = parseVerdictResponse(resp(J({ reason: 'meets every criterion', verdict: 'PASS' })));
  assert.deepEqual([p.ok, p.verdict, p.reason], [true, 'PASS', 'meets every criterion']);
  p = parseVerdictResponse(resp(J({ verdict: 'FAIL', reason: 'r' }))); // key order free
  assert.deepEqual([p.ok, p.verdict], [true, 'FAIL']);
  p = parseVerdictResponse(resp(`  \n\t${J({ reason: 'r', verdict: 'PASS' })}\r\n `)); // surrounding whitespace allowed
  assert.equal(p.ok, true);
  assert.equal(parseVerdictResponse(resp(J({ reason: 'a'.repeat(400), verdict: 'PASS' }))).ok, true);
  assert.equal(parseVerdictResponse(resp(J({ reason: 'あ'.repeat(400), verdict: 'PASS' }))).ok, true); // 400 code units, 1200 bytes
  assert.equal(parseVerdictResponse(resp(J({ reason: '😀'.repeat(200), verdict: 'PASS' }))).ok, true); // 400 UTF-16 code units
});

test('verdict: reason length is counted in UTF-16 code units', () => {
  assert.equal(parseVerdictResponse(resp(J({ reason: 'a'.repeat(401), verdict: 'PASS' }))).ok, false);
  assert.equal(parseVerdictResponse(resp(J({ reason: '😀'.repeat(200) + 'a', verdict: 'PASS' }))).ok, false); // 401 units
  assert.equal(parseVerdictResponse(resp(J({ reason: '', verdict: 'PASS' }))).ok, false);
  assert.equal(parseVerdictResponse(resp(J({ reason: 7, verdict: 'PASS' }))).ok, false);
  assert.equal(parseVerdictResponse(resp(J({ reason: null, verdict: 'PASS' }))).ok, false);
});

test('verdict: envelope failures are rejected', () => {
  assert.equal(parseVerdictResponse(resp(J({ reason: 'r', verdict: 'PASS' }), { finish: 'length' })).ok, false);
  assert.equal(parseVerdictResponse(resp(J({ reason: 'r', verdict: 'PASS' }), { finish: null })).ok, false);
  assert.equal(parseVerdictResponse(raw('not json')).ok, false);
  assert.equal(parseVerdictResponse(Uint8Array.from([0xff, 0xfe, 0x7b, 0x7d])).ok, false); // not UTF-8
  assert.equal(parseVerdictResponse(raw(J({ choices: [] }))).ok, false);
  assert.equal(parseVerdictResponse(raw(J({ id: 'x' }))).ok, false);
  assert.equal(parseVerdictResponse(raw(J({ choices: [{ finish_reason: 'stop', message: { content: { reason: 'r', verdict: 'PASS' } } }] }))).ok, false); // content not a string
});

test('verdict: content must be exactly one JSON object', () => {
  assert.equal(parseVerdictResponse(resp('```json\n' + J({ reason: 'r', verdict: 'PASS' }) + '\n```')).ok, false);
  assert.equal(parseVerdictResponse(resp('Verdict: ' + J({ reason: 'r', verdict: 'PASS' }))).ok, false);
  assert.equal(parseVerdictResponse(resp(J({ reason: 'r', verdict: 'PASS' }) + ' Done.')).ok, false);
  assert.equal(parseVerdictResponse(resp(J([{ reason: 'r', verdict: 'PASS' }]))).ok, false);
  assert.equal(parseVerdictResponse(resp('"PASS"')).ok, false);
});

test('verdict: keys and verdict values are exact', () => {
  assert.equal(parseVerdictResponse(resp(J({ reason: 'r', verdict: 'PASS', score: 90 }))).ok, false); // extra field
  assert.equal(parseVerdictResponse(resp(J({ verdict: 'PASS' }))).ok, false); // missing reason
  assert.equal(parseVerdictResponse(resp(J({ reason: 'r' }))).ok, false); // missing verdict
  for (const bad of ['pass', 'Pass', ' PASS', 'PASS ', 'FAILED', 'UPHOLD', true, 1, null]) {
    assert.equal(parseVerdictResponse(resp(J({ reason: 'r', verdict: bad }))).ok, false, `verdict ${JSON.stringify(bad)}`);
  }
});

test('comparison: same strictness with decision UPHOLD / OVERTURN', () => {
  let p = parseComparisonResponse(resp(J({ decision: 'OVERTURN', reason: 'not supported by the record' })));
  assert.deepEqual([p.ok, p.decision], [true, 'OVERTURN']);
  p = parseComparisonResponse(resp(J({ reason: 'supported', decision: 'UPHOLD' })));
  assert.deepEqual([p.ok, p.decision], [true, 'UPHOLD']);
  for (const bad of ['Overturn', 'overturn', 'PASS', ' UPHOLD', 'REVERSE']) {
    assert.equal(parseComparisonResponse(resp(J({ decision: bad, reason: 'r' }))).ok, false, bad);
  }
  assert.equal(parseComparisonResponse(resp(J({ reason: 'r', verdict: 'PASS' }))).ok, false); // wrong schema
  assert.equal(parseComparisonResponse(resp(J({ decision: 'UPHOLD', reason: 'r', extra: 1 }))).ok, false);
  assert.equal(parseComparisonResponse(resp(J({ decision: 'UPHOLD', reason: 'x'.repeat(401) }))).ok, false);
  assert.equal(parseComparisonResponse(resp(J({ decision: 'UPHOLD', reason: 'r' }), { finish: 'length' })).ok, false);
  assert.equal(parseVerdictResponse(resp(J({ decision: 'UPHOLD', reason: 'r' }))).ok, false); // and vice versa
});

test('signed usage is read from the response bytes', () => {
  assert.deepEqual(signedUsage(resp(J({ reason: 'r', verdict: 'PASS' }))), { in: 10, out: 5 });
  assert.equal(signedUsage(resp(J({ reason: 'r', verdict: 'PASS' }), { usage: null })), null);
  assert.equal(signedUsage(resp(J({ reason: 'r', verdict: 'PASS' }), { usage: { prompt_tokens: -1, completion_tokens: 5 } })), null);
  assert.equal(signedUsage(resp(J({ reason: 'r', verdict: 'PASS' }), { usage: { prompt_tokens: 1.5, completion_tokens: 5 } })), null);
});
