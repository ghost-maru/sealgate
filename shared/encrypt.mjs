// Sealgate response encryption (SPEC v2 §2): the full signed inspection response is
// stored on-chain ONLY as ciphertext readable by the two parties of the escrow.
// Per-escrow X25519 keypairs (NEAR account keys are never reused); ECDH shared secret
// -> HKDF-SHA256 (salt = escrow id) -> XChaCha20-Poly1305. AAD binds escrow id, claim
// level, and the response hash (the claim's on-chain resp_hash), so a ciphertext
// cannot be replayed under another escrow, level, or response. Plaintext is padded
// to a fixed size before encryption, so ciphertext length reveals nothing.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from 'node:crypto';

export const PADDED_PLAINTEXT = 1008; // + 24B nonce + 16B tag = 1048B -> 1398 base64 chars
const INFO = new TextEncoder().encode('sealgate-response-v1');
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h.replace(/^0x/, ''), 'hex'));

export function genKeypair() {
  const secret = x25519.utils.randomSecretKey();
  return { secretKey: hex(secret), publicKey: hex(x25519.getPublicKey(secret)) };
}

// Both parties derive the identical key: ECDH(my secret, their public).
export function deriveKey(mySecretHex, theirPublicHex, escrowId) {
  const shared = x25519.getSharedSecret(unhex(mySecretHex), unhex(theirPublicHex));
  return hkdf(sha256, shared, new TextEncoder().encode(String(escrowId)), INFO, 32);
}

const aad = (escrowId, level, respHashHex) =>
  new TextEncoder().encode(`${escrowId}:${level}:${respHashHex.toLowerCase().replace(/^0x/, '')}`);

// responseBytes: the exact signed response bytes. respHashHex: sha256 of them (the
// claim's resp_hash). Returns base64(nonce || ciphertext), always the same length.
export function encryptResponse({ key, escrowId, level, responseBytes, respHashHex }) {
  if (responseBytes.length > PADDED_PLAINTEXT - 2) throw new Error('response too large for the fixed-size envelope');
  const plain = new Uint8Array(PADDED_PLAINTEXT);
  plain[0] = (responseBytes.length >> 8) & 0xff;
  plain[1] = responseBytes.length & 0xff;
  plain.set(responseBytes, 2);
  const pad = randomBytes(PADDED_PLAINTEXT - 2 - responseBytes.length);
  plain.set(pad, 2 + responseBytes.length);
  const nonce = randomBytes(24);
  const ct = xchacha20poly1305(key, nonce, aad(escrowId, level, respHashHex)).encrypt(plain);
  return Buffer.concat([nonce, ct]).toString('base64');
}

export function decryptResponse({ key, escrowId, level, respHashHex, ciphertextB64 }) {
  const raw = Buffer.from(ciphertextB64, 'base64');
  const nonce = new Uint8Array(raw.subarray(0, 24));
  const ct = new Uint8Array(raw.subarray(24));
  const plain = xchacha20poly1305(key, nonce, aad(escrowId, level, respHashHex)).decrypt(ct);
  const len = (plain[0] << 8) | plain[1];
  return Buffer.from(plain.subarray(2, 2 + len));
}
