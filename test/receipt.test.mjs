import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReceipt, verifyReceipt } from '../shared/receipt.mjs';

// Same REAL Day-1 spike fixtures as test/verify.test.mjs (vendored in test/fixtures/).
const R = new URL('./fixtures/', import.meta.url);
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
const signers = [`ecdsa:${att.model_attestations[0].signing_address}`];

// The Day-1 fixture predates escrow binding, so it carries no escrow identity (null ref).
const fixtureReceipt = () => buildReceipt({
  contract: null, escrowId: null,
  record: { criteria, deliverable, l0: { responseB64: read('response.json').toString('base64') } },
  claims: [claim], signers, exportedAt: '2026-11-08T00:00:00.000Z',
});

test('receipt: built from the Day-1 fixture verifies ok', () => {
  const r = fixtureReceipt();
  assert.equal(r.kind, 'sealgate-receipt');
  assert.equal(r.version, 1);
  const res = verifyReceipt(r);
  assert.deepEqual(res.failures, []);
  assert.equal(res.ok, true);
  assert.equal(res.verdict, 'PASS');
});

test('receipt: survives a JSON round trip', () => {
  const res = verifyReceipt(JSON.parse(JSON.stringify(fixtureReceipt())));
  assert.equal(res.ok, true);
});

test('receipt: flipping the published verdict makes it NOT ok', () => {
  const r = fixtureReceipt();
  r.claims = [{ ...claim, verdict: 'FAIL' }];
  const res = verifyReceipt(r);
  assert.equal(res.ok, false);
  assert.ok(res.failures.some((f) => f.includes('published verdict')));
});

test('receipt: changing one character of the deliverable makes it NOT ok', () => {
  const r = fixtureReceipt();
  const c = r.deliverable[0];
  r.deliverable = (c === 'X' ? 'Y' : 'X') + r.deliverable.slice(1);
  const res = verifyReceipt(r);
  assert.equal(res.ok, false);
  assert.ok(res.failures.some((f) => f.includes('request binding')));
});

test('receipt: a missing response fails', () => {
  const r = fixtureReceipt();
  r.responsesByLevel = {};
  const res = verifyReceipt(r);
  assert.equal(res.ok, false);
  assert.ok(res.failures.some((f) => f.includes('response bytes are missing')));
});

test('receipt: wrong kind/version or missing L0 claim fails', () => {
  assert.equal(verifyReceipt({ ...fixtureReceipt(), kind: 'other' }).ok, false);
  assert.equal(verifyReceipt({ ...fixtureReceipt(), version: 2 }).ok, false);
  const noL0 = verifyReceipt({ ...fixtureReceipt(), claims: [{ ...claim, level: 1 }] });
  assert.equal(noL0.ok, false);
  assert.ok(noL0.failures.some((f) => f.includes('level-0 claim is missing')));
});

test('receipt: a signer outside the snapshot registry fails', () => {
  const res = verifyReceipt({ ...fixtureReceipt(), signers: ['ecdsa:0x0000000000000000000000000000000000000001'] });
  assert.equal(res.ok, false);
  assert.ok(res.failures.some((f) => f.includes('registry')));
});

test('receipt: with an escrow identity, the null-ref claim does not pass', () => {
  const r = buildReceipt({
    contract: 'app2.sealgate-ghost.testnet', escrowId: 2,
    record: { criteria, deliverable, l0: { responseB64: read('response.json').toString('base64') } },
    claims: [claim], signers, exportedAt: '2026-11-08T00:00:00.000Z',
  });
  const res = verifyReceipt(r);
  assert.equal(res.ok, false);
  assert.ok(res.failures.some((f) => f.includes('request binding')));
});

test('receipt: a salt the claim was not signed over makes it NOT ok (salt binds)', () => {
  const r = fixtureReceipt();
  r.salt = 'deadbeefdeadbeefdeadbeefdeadbeef';
  const res = verifyReceipt(r);
  assert.equal(res.ok, false);
  assert.ok(res.failures.some((f) => f.includes('request binding')));
});

test('receipt: buildReceipt carries the record salt through', () => {
  const r = buildReceipt({
    contract: null, escrowId: null,
    record: { criteria, deliverable, salt: 'abc123', l0: { responseB64: read('response.json').toString('base64') } },
    claims: [claim], signers, exportedAt: '2026-11-08T00:00:00.000Z',
  });
  assert.equal(r.salt, 'abc123');
});
