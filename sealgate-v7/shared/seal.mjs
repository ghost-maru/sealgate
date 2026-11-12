// Sealgate v7 cryptographic material (SPEC-v7-KERNEL §7.2–§7.5).
//
//   ctx         "sealgate7|" || contract || "|" || caseId
//   commit      sha256(salt || body), salt = 16 random bytes (§2.2)
//   Seal        envelope: E || XChaCha20-Poly1305(key, nonce, m, aad = ctx || label),
//               key || nonce = HKDF-SHA256(ss, sha256(ctx), label || E || pk, 56)
//   Enc         bulk: nonce(24) || XChaCha20-Poly1305(HKDF(k, sha256(ctx), label, 32), nonce, pad(m), aad = ctx || label)
//   pad         u16be(|m|) || m || random fill to exactly N bytes:
//               std/sub N = max(1024, ceil((|m| + 2) / 1024) * 1024); resp0 N = 1008; resp1 N = 8192
//   K1/K2       K, K2 independent 32-byte randoms; K1 = K xor K2; lock = sha256(K2)
//
// Libraries: @noble/curves, @noble/hashes, @noble/ciphers (§7.3).

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes as nodeRandomBytes } from 'node:crypto';

export { sha256 };
export const randomBytes = (n) => new Uint8Array(nodeRandomBytes(n));

export const CONTEXT_PREFIX = 'sealgate7|';
export const SALT_LEN = 16;
export const KEY_LEN = 32;
export const NONCE_LEN = 24;
export const TAG_LEN = 16;
export const LEN_PREFIX = 2;
export const PAD_UNIT = 1024;
export const RESP0_PAD = 1008;
export const RESP1_PAD = 8192;
export const USAGE_UNIT = 1024;
export const LABELS = Object.freeze({ std: 'std', sub: 'sub', resp0: 'resp0', resp1: 'resp1', wSkS: 'wSkS', wC: 'wC', wR: 'wR', eR: 'eR' });

const te = new TextEncoder();
const td = new TextDecoder('utf-8', { fatal: true });
export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (b) => td.decode(b);
export const toHex = (b) => Buffer.from(b).toString('hex');
export const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
export const toB64 = (b) => Buffer.from(b).toString('base64');
export const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function xor(a, b) {
  if (a.length !== b.length) throw new Error('xor: length mismatch');
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ---------------------------------------------------------------- context
export const ctxOf = (contract, caseId) => utf8(`${CONTEXT_PREFIX}${contract}|${caseId}`);
const asBytes = (x) => (typeof x === 'string' ? utf8(x) : x);

// ------------------------------------------------------------ commitments
export const newSalt = () => randomBytes(SALT_LEN);
export function commit(salt, body) {
  if (salt.length !== SALT_LEN) throw new Error('salt must be 16 bytes');
  return toHex(sha256(concat(salt, asBytes(body))));
}

// ---------------------------------------------------------------- padding
export function paddedLen(messageLen) {
  return Math.max(PAD_UNIT, Math.ceil((messageLen + LEN_PREFIX) / PAD_UNIT) * PAD_UNIT);
}
export function padSizeFor(label, messageLen) {
  if (label === LABELS.resp0) return RESP0_PAD;
  if (label === LABELS.resp1) return RESP1_PAD;
  if (label === LABELS.std || label === LABELS.sub) return paddedLen(messageLen);
  throw new Error(`no padding rule for label ${label}`);
}
export function pad(m, n) {
  if (m.length > 0xffff) throw new Error('message too long for the u16be length prefix');
  if (m.length > n - LEN_PREFIX) throw new Error(`message of ${m.length} bytes does not fit ${n} padded bytes`);
  const out = randomBytes(n); // random fill r
  out[0] = m.length >> 8;
  out[1] = m.length & 0xff;
  out.set(m, LEN_PREFIX);
  return out;
}
export function unpad(p) {
  if (p.length < LEN_PREFIX) throw new Error('padded message too short');
  const len = (p[0] << 8) | p[1];
  if (len > p.length - LEN_PREFIX) throw new Error('length prefix exceeds the padded message');
  return p.slice(LEN_PREFIX, LEN_PREFIX + len);
}
// Ciphertext length of Enc for a std/sub message of `messageLen` bytes, and
// the maximum for a body limit L (salt included), as in §6.1.
export const bucketCiphertextLen = (messageLen) => NONCE_LEN + paddedLen(messageLen) + TAG_LEN;
export const maxBucketCiphertextLen = (limit) => bucketCiphertextLen(SALT_LEN + limit);
export const RESP0_CT_LEN = NONCE_LEN + RESP0_PAD + TAG_LEN;
export const RESP1_CT_LEN = NONCE_LEN + RESP1_PAD + TAG_LEN;

// ------------------------------------------------------------------- Enc
function subkey(k, ctx, label) {
  return hkdf(sha256, k, sha256(ctx), utf8(label), 32);
}
export function enc(k, label, m, ctx, nonce = randomBytes(NONCE_LEN)) {
  if (k.length !== KEY_LEN) throw new Error('Enc key must be 32 bytes');
  const msg = asBytes(m);
  const padded = pad(msg, padSizeFor(label, msg.length));
  const aead = xchacha20poly1305(subkey(k, ctx, label), nonce, concat(ctx, utf8(label)));
  return concat(nonce, aead.encrypt(padded));
}
export function dec(k, label, ct, ctx) {
  if (ct.length < NONCE_LEN + TAG_LEN) throw new Error('ciphertext too short');
  const nonce = ct.slice(0, NONCE_LEN);
  const aead = xchacha20poly1305(subkey(k, ctx, label), nonce, concat(ctx, utf8(label)));
  return unpad(aead.decrypt(ct.slice(NONCE_LEN)));
}

// ------------------------------------------------------------------ Seal
export function keypair(sk = randomBytes(32)) {
  return { sk, pk: x25519.getPublicKey(sk) };
}
function sealKeys(ss, ctx, label, E, pk) {
  if (ss.every((b) => b === 0)) throw new Error('X25519 shared secret is all-zero');
  const okm = hkdf(sha256, ss, sha256(ctx), concat(utf8(label), E, pk), 56);
  return { key: okm.slice(0, 32), nonce: okm.slice(32, 56) };
}
export function seal(pk, m, label, e, ctx) {
  const E = x25519.getPublicKey(e);
  const ss = x25519.getSharedSecret(e, pk);
  const { key, nonce } = sealKeys(ss, ctx, label, E, pk);
  return concat(E, xchacha20poly1305(key, nonce, concat(ctx, utf8(label))).encrypt(asBytes(m)));
}
export function open(sk, sealed, label, ctx) {
  if (sealed.length < 32 + TAG_LEN) throw new Error('envelope too short');
  const E = sealed.slice(0, 32);
  const pk = x25519.getPublicKey(sk);
  const ss = x25519.getSharedSecret(sk, E);
  const { key, nonce } = sealKeys(ss, ctx, label, E, pk);
  return xchacha20poly1305(key, nonce, concat(ctx, utf8(label))).decrypt(sealed.slice(32));
}

// ---------------------------------------------------- K1 / K2 and the lock
export function splitKey(K = randomBytes(KEY_LEN), K2 = randomBytes(KEY_LEN)) {
  return { K, K2, K1: xor(K, K2), lock: toHex(sha256(K2)) };
}
export const joinKey = (K1, k2) => xor(K1, k2);
export const lockOf = (k2) => toHex(sha256(k2));
export const checkLock = (k2, lock) => lockOf(k2) === lock;
// e_R = HKDF(K || K2, sha256(ctx), "eR", 32): the requester's envelope is
// deterministic, so the clerk can recompute it byte for byte (§7.5 check 4).
export const eROf = (K, K2, ctx) => hkdf(sha256, concat(K, K2), sha256(ctx), utf8(LABELS.eR), 32);

// ------------------------------------------------------ material builders

// The requester's material at create_case (§7.4).
export function buildCriteria({ contract, caseId, criteria, submitterPk, SK = randomBytes(KEY_LEN), salt = newSalt() }) {
  const ctx = ctxOf(contract, caseId);
  const body = asBytes(criteria);
  return {
    SK, salt,
    criteria_hash: commit(salt, body),
    criteria_ct: toB64(enc(SK, LABELS.std, concat(salt, body), ctx)),
    env_s: toB64(seal(submitterPk, SK, LABELS.wSkS, randomBytes(32), ctx)),
  };
}

// The submitter's material at submit (§7.4): the clerk's whole input.
export function buildSubmission({ contract, caseId, submission, SK, clerkPk, requesterPk, salt = newSalt(), K, K2 }) {
  const ctx = ctxOf(contract, caseId);
  const body = asBytes(submission);
  const keys = splitKey(K, K2);
  return {
    ...keys, salt,
    sub_hash: commit(salt, body),
    sub_ct: toB64(enc(keys.K, LABELS.sub, concat(salt, body), ctx)),
    env_c: toB64(seal(clerkPk, concat(SK, keys.K, keys.K2), LABELS.wC, randomBytes(32), ctx)),
    env_r: toB64(seal(requesterPk, keys.K1, LABELS.wR, eROf(keys.K, keys.K2, ctx), ctx)),
    lock: keys.lock,
  };
}

// Responses are encrypted under K1, packed to fixed sizes (§7.3, §8.2).
export const encResponse = (K1, response, ctx) => enc(K1, LABELS.resp0, response, ctx);
export const encAppealRecord = (K1, record, ctx) => enc(K1, LABELS.resp1, record, ctx);

// Splits a std/sub plaintext back into (salt, body).
export function splitSalted(m) {
  if (m.length < SALT_LEN) throw new Error('salted message too short');
  return { salt: m.slice(0, SALT_LEN), body: m.slice(SALT_LEN) };
}

// The clerk's format checks 1–4 (§7.5), code only. Returns { ok, defect,
// SK, K, K2, criteria, submission }. Size limits are the case's pinned L_crit / L_sub.
export function formatCheck({ contract, caseId, clerkSk, requesterPk, material, lCrit, lSub }) {
  const ctx = ctxOf(contract, caseId);
  let keys;
  try { keys = open(clerkSk, fromB64(material.env_c), LABELS.wC, ctx); } catch { return { ok: false, defect: 1 }; }
  if (keys.length !== 96) return { ok: false, defect: 1 };
  const SK = keys.slice(0, 32), K = keys.slice(32, 64), K2 = keys.slice(64, 96);
  let crit, sub;
  try { crit = splitSalted(dec(SK, LABELS.std, fromB64(material.criteria_ct), ctx)); } catch { return { ok: false, defect: 2 }; }
  if (commit(crit.salt, crit.body) !== material.criteria_hash || crit.body.length > lCrit) return { ok: false, defect: 2 };
  try { sub = splitSalted(dec(K, LABELS.sub, fromB64(material.sub_ct), ctx)); } catch { return { ok: false, defect: 3 }; }
  if (commit(sub.salt, sub.body) !== material.sub_hash || sub.body.length > lSub) return { ok: false, defect: 3 };
  if (lockOf(K2) !== material.lock) return { ok: false, defect: 4 };
  const envR = seal(requesterPk, xor(K, K2), LABELS.wR, eROf(K, K2, ctx), ctx);
  if (!equalBytes(envR, fromB64(material.env_r))) return { ok: false, defect: 4 };
  return { ok: true, defect: 0, SK, K, K2, criteria: crit.body, submission: sub.body };
}

// Declared usage is rounded up to 1,024-token units (§6.1 step 1).
export const roundUsage = (tokens) => Math.ceil(tokens / USAGE_UNIT) * USAGE_UNIT;
