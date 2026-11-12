// Sealed bundles: X25519-encrypted file handoffs between independent processes
// (appellant -> appellate executor, worker -> buyer). A bundle lets one actor
// hand the private record to exactly one other actor without a shared
// filesystem record: ephemeral X25519 keypair -> ECDH -> HKDF-SHA256
// (salt = escrow id, info 'sealgate-bundle-v1') -> XChaCha20-Poly1305 with
// AAD 'bundle:<escrowId>'. Same primitives as the response envelope.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from 'node:crypto';

const INFO = new TextEncoder().encode('sealgate-bundle-v1');
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (h) => new Uint8Array(Buffer.from(h.replace(/^0x/, ''), 'hex'));
const aad = (escrowId) => new TextEncoder().encode(`bundle:${escrowId}`);

function derive(ephemeralOrMineSecretHex, otherPublicHex, escrowId) {
  const shared = x25519.getSharedSecret(unhex(ephemeralOrMineSecretHex), unhex(otherPublicHex));
  return hkdf(sha256, shared, new TextEncoder().encode(String(escrowId)), INFO, 32);
}

// payload: any JSON-serializable object. Returns the bundle object (write it as JSON).
export function sealBundle({ toPublicHex, escrowId, payload }) {
  const eph = x25519.utils.randomSecretKey();
  const key = derive(hex(eph), toPublicHex, escrowId);
  const nonce = randomBytes(24);
  const pt = new TextEncoder().encode(JSON.stringify(payload));
  const ct = xchacha20poly1305(key, nonce, aad(escrowId)).encrypt(pt);
  return {
    kind: 'sealgate-bundle', version: 1, escrowId,
    ephemeralPublic: hex(x25519.getPublicKey(eph)),
    nonce: hex(nonce), ciphertext: Buffer.from(ct).toString('base64'),
  };
}

export function openBundle({ mySecretHex, bundle }) {
  if (bundle?.kind !== 'sealgate-bundle') throw new Error('not a sealgate bundle');
  const key = derive(mySecretHex, bundle.ephemeralPublic, bundle.escrowId);
  const pt = xchacha20poly1305(key, unhex(bundle.nonce), aad(bundle.escrowId))
    .decrypt(new Uint8Array(Buffer.from(bundle.ciphertext, 'base64')));
  return JSON.parse(new TextDecoder().decode(pt));
}
