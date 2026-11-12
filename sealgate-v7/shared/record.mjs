// Plaintext containers of the clerk's postings (SPEC-v7-KERNEL §7.3, §8.2, §8.4).
//
// The primary response is Enc(K1, "resp0", m) with |m| <= 1006 (padded to
// 1008); the appeal record is Enc(K1, "resp1", m) with |m| <= 8190 (padded to
// 8192). This module defines m:
//
//   m = "SG7" || 0x01 || u16be(|header|) || header (UTF-8 JSON) || payload
//
// header.k is the record kind:
//   "primary"  a model judgment. header = { k, req, sig: { kind, algo, addr, sig }, z }
//              req = sha256 hex of the exact request bytes; z = { off, len } of the
//              deflate-raw compressed signed response bytes inside payload. The
//              response hash and the signed text "<model>:<req>:<resp>" are
//              recomputed by the reader from the bytes and the pinned model,
//              so the record carries the model output, the usage (inside the
//              signed bytes), both hashes (one explicit, one by recomputation)
//              and the TEE signature (§8.2 "what the clerk posts").
//   "formal"   a formal-inspection result, no model call (§7.5).
//              header = { k, verdict, check | null, side | null, heading | null, reason }
//   "appeal"   the appeal record (§8.4 step 4); see clerk/appeal.mjs.
//
// Check-1 defects: when the clerk envelope does not open, the clerk has no K1.
// The response is then encrypted under CHECK1_RESPONSE_KEY (32 zero bytes),
// which is public on purpose: such a record holds only the notice "check 1
// failed" and no case material. Readers try K1 first, then this key.

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { utf8, fromUtf8, concat, RESP0_PAD, RESP1_PAD, LEN_PREFIX } from './seal.mjs';

export const MAGIC = Uint8Array.from([0x53, 0x47, 0x37, 0x01]); // "SG7" v1
export const RESP0_MAX = RESP0_PAD - LEN_PREFIX; // 1006
export const RESP1_MAX = RESP1_PAD - LEN_PREFIX; // 8190
export const CHECK1_RESPONSE_KEY = new Uint8Array(32);

export const deflate = (bytes) => new Uint8Array(deflateRawSync(bytes, { level: 9 }));
export const inflate = (bytes) => new Uint8Array(inflateRawSync(bytes));

export function encodeRecord(header, payload = new Uint8Array(0)) {
  const h = utf8(JSON.stringify(header));
  if (h.length > 0xffff) throw new Error('record header too long');
  return concat(MAGIC, Uint8Array.from([h.length >> 8, h.length & 0xff]), h, payload);
}

export function decodeRecord(bytes) {
  if (bytes.length < MAGIC.length + 2) throw new Error('record too short');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) throw new Error('not a sealgate7 record');
  const hl = (bytes[4] << 8) | bytes[5];
  if (6 + hl > bytes.length) throw new Error('record header length exceeds the record');
  const header = JSON.parse(fromUtf8(bytes.slice(6, 6 + hl)));
  if (header === null || typeof header !== 'object' || Array.isArray(header)) throw new Error('record header is not an object');
  return { header, payload: bytes.slice(6 + hl) };
}

export function payloadSlice(payload, ref) {
  if (!ref || !Number.isSafeInteger(ref.off) || !Number.isSafeInteger(ref.len) || ref.off < 0 || ref.len < 0 || ref.off + ref.len > payload.length) {
    throw new Error('bad payload reference');
  }
  return payload.slice(ref.off, ref.off + ref.len);
}

const strip0x = (h) => String(h || '').toLowerCase().replace(/^0x/, '');
export const compactSig = (s) => ({ kind: s.signature_kind, algo: s.signing_algo, addr: strip0x(s.signing_address), sig: strip0x(s.signature) });

export function encodePrimaryRecord({ reqHash, signature, respBytes }) {
  const z = deflate(respBytes);
  return encodeRecord({ k: 'primary', req: reqHash, sig: compactSig(signature), z: { off: 0, len: z.length } }, z);
}

// f: a non-ok result of clerk/formal.mjs formalInspection.
export function encodeFormalRecord(f) {
  return encodeRecord({
    k: 'formal',
    verdict: f.verdict,
    check: f.status === 'defect' ? f.check : null,
    side: f.status === 'missing' ? f.side : null,
    heading: f.status === 'missing' ? f.heading : null,
    reason: f.reason,
  });
}
