import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyIntegrity, verifyResponseBinding, parseVerdict } from '../shared/verify.mjs';
import { validateGrounds, buildInspectionRequest } from '../shared/templates.mjs';

// Uses the REAL fixtures captured by the Day-1 spike (../spike/results).
const R = new URL('../../spike/results/', import.meta.url);
const read = (n) => readFileSync(new URL(n, R));
const reqJson = JSON.parse(read('request.json').toString('utf8'));
const sig = JSON.parse(read('signature.json').toString('utf8'));
const att = JSON.parse(read('attestation.json').toString('utf8'));

const userContent = reqJson.messages[1].content;
const criteria = userContent.split('ACCEPTANCE CRITERIA:\n')[1].split('\n\nDELIVERABLE:\n')[0];
const deliverable = userContent.split('\n\nDELIVERABLE:\n')[1];
const [, reqHash, respHash] = sig.text.split(':');
const claim = {
  level: 0, verdict: 'PASS', reqHash, respHash,
  signature: sig.signature, signingAlgo: sig.signing_algo, signingAddress: sig.signing_address,
  signatureKind: sig.signature_kind,
};
const registered = [att.model_attestations[0].signing_address];

test('fixture: canonical builder reproduces the exact spike request bytes', () => {
  const rebuilt = buildInspectionRequest({ criteria, deliverable });
  assert.equal(rebuilt.toString('utf8'), read('request.json').toString('utf8'));
});

test('fixture: integrity stage passes on the real Day-1 record', () => {
  const a = verifyIntegrity({ criteria, deliverable, claim, registeredSigners: registered });
  assert.deepEqual(a.failures, []);
  const b = verifyResponseBinding({ claim, responseBytes: read('response.json'), registeredSigners: registered });
  assert.deepEqual(b, []);
});

test('fixture: a forged claim (req over a different deliverable) fails step 1', () => {
  const a = verifyIntegrity({ criteria, deliverable: 'Totally different text', claim, registeredSigners: registered });
  assert.ok(a.failures.some((f) => f.includes('request binding')));
});

test('fixture: published verdict mismatch is caught', () => {
  const bad = { ...claim, verdict: 'FAIL' };
  const b = verifyResponseBinding({ claim: bad, responseBytes: read('response.json'), registeredSigners: registered });
  assert.ok(b.some((f) => f.includes('published verdict')));
});

test('verdict parser enforces the v1.1 format', () => {
  const wrap = (content, fin = 'stop') => Buffer.from(JSON.stringify({ choices: [{ finish_reason: fin, message: { content } }] }));
  assert.equal(parseVerdict(wrap('{"reason":"ok","verdict":"PASS"}')).ok, true);
  assert.equal(parseVerdict(wrap('{"reason":"ok","verdict":"PASS","extra":1}')).ok, false);
  assert.equal(parseVerdict(wrap('{"reason":"ok","verdict":"MAYBE"}')).ok, false);
  assert.equal(parseVerdict(wrap('{"reason":"ok","verdict":"PASS"}', 'length')).ok, false);
  assert.equal(parseVerdict(wrap('not json')).ok, false);
});

test('escrow binding: the fixture claim verifies only under the legacy (null) ref', () => {
  const okLegacy = verifyIntegrity({ criteria, deliverable, claim, registeredSigners: registered });
  assert.deepEqual(okLegacy.failures, []);
  const wrongRef = verifyIntegrity({ criteria, deliverable, escrowRef: 'app2.sealgate-ghost.testnet#9', claim, registeredSigners: registered });
  assert.ok(wrongRef.failures.some((f) => f.includes('request binding')));
});

test('grounds validation (legal proposal 3: pre-specification is admissibility)', () => {
  assert.deepEqual(validateGrounds({ errorType: 'MISSED_ELEMENT', target: 'reason sentence 1', detail: 'The deliverable does contain the required word.' }), []);
  assert.ok(validateGrounds({ errorType: 'VIBES', target: 'x', detail: 'y' }).length > 0);
  assert.ok(validateGrounds({ errorType: 'MISSED_ELEMENT', target: '', detail: 'y' }).length > 0);
  assert.ok(validateGrounds({ errorType: 'MISSED_ELEMENT', target: 'x', detail: 'y'.repeat(600) }).length > 0);
});
