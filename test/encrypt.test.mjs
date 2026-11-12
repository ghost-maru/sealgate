import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genKeypair, deriveKey, encryptResponse, decryptResponse, PADDED_PLAINTEXT } from '../shared/encrypt.mjs';
import { sha256hex } from '../shared/verify.mjs';

const resp = Buffer.from(JSON.stringify({ id: 'chatcmpl-x', choices: [{ finish_reason: 'stop', message: { content: '{"reason":"ok","verdict":"PASS"}' } }] }));
const respHash = sha256hex(resp);
const buyer = genKeypair(); const worker = genKeypair(); const outsider = genKeypair();
const kBuyer = deriveKey(buyer.secretKey, worker.publicKey, 7);
const kWorker = deriveKey(worker.secretKey, buyer.publicKey, 7);

test('both parties derive the same key; an outsider derives a different one', () => {
  assert.deepEqual(Buffer.from(kBuyer), Buffer.from(kWorker));
  const kOut = deriveKey(outsider.secretKey, worker.publicKey, 7);
  assert.notDeepEqual(Buffer.from(kOut), Buffer.from(kBuyer));
});

test('round-trip: either party decrypts; ciphertext is fixed-length', () => {
  const ct = encryptResponse({ key: kBuyer, escrowId: 7, level: 0, responseBytes: resp, respHashHex: respHash });
  assert.equal(Buffer.from(ct, 'base64').length, 24 + PADDED_PLAINTEXT + 16);
  assert.deepEqual(decryptResponse({ key: kWorker, escrowId: 7, level: 0, respHashHex: respHash, ciphertextB64: ct }), resp);
  const short = Buffer.from('{}');
  const ct2 = encryptResponse({ key: kBuyer, escrowId: 7, level: 0, responseBytes: short, respHashHex: sha256hex(short) });
  assert.equal(ct2.length, ct.length); // length reveals nothing about content size
});

test('AAD binding: wrong escrow, level, or resp hash fails to decrypt', () => {
  const ct = encryptResponse({ key: kBuyer, escrowId: 7, level: 0, responseBytes: resp, respHashHex: respHash });
  assert.throws(() => decryptResponse({ key: kWorker, escrowId: 8, level: 0, respHashHex: respHash, ciphertextB64: ct }));
  assert.throws(() => decryptResponse({ key: kWorker, escrowId: 7, level: 1, respHashHex: respHash, ciphertextB64: ct }));
  assert.throws(() => decryptResponse({ key: kWorker, escrowId: 7, level: 0, respHashHex: 'a'.repeat(64), ciphertextB64: ct }));
});

test('tampering and wrong keys fail (AEAD)', () => {
  const ct = encryptResponse({ key: kBuyer, escrowId: 7, level: 0, responseBytes: resp, respHashHex: respHash });
  const raw = Buffer.from(ct, 'base64'); raw[40] ^= 1;
  assert.throws(() => decryptResponse({ key: kWorker, escrowId: 7, level: 0, respHashHex: respHash, ciphertextB64: raw.toString('base64') }));
  const kOut = deriveKey(outsider.secretKey, buyer.publicKey, 7);
  assert.throws(() => decryptResponse({ key: kOut, escrowId: 7, level: 0, respHashHex: respHash, ciphertextB64: ct }));
});

test('a different escrow id derives a different key (HKDF salt separation)', () => {
  const k8 = deriveKey(buyer.secretKey, worker.publicKey, 8);
  assert.notDeepEqual(Buffer.from(k8), Buffer.from(kBuyer));
});

test('encrypt: L1 envelope fits a reasoning-heavy response and round-trips', () => {
  const a = genKeypair(); const b = genKeypair();
  const keyA = deriveKey(a.secretKey, b.publicKey, 7);
  const keyB = deriveKey(b.secretKey, a.publicKey, 7);
  const big = Buffer.alloc(5000, 65); // ~5KB raw response JSON (GLM reasoning_content)
  const ct = encryptResponse({ key: keyA, escrowId: 7, level: 1, responseBytes: big, respHashHex: 'ab'.repeat(32) });
  assert.equal(Buffer.from(ct, 'base64').length, 24 + 8192 + 16);
  const back = decryptResponse({ key: keyB, escrowId: 7, level: 1, respHashHex: 'ab'.repeat(32), ciphertextB64: ct });
  assert.ok(back.equals(big));
  // L0 keeps the small bucket and still rejects oversize.
  assert.throws(() => encryptResponse({ key: keyA, escrowId: 7, level: 0, responseBytes: big, respHashHex: 'ab'.repeat(32) }), /too large/);
});
