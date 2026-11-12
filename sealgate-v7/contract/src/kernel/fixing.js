// Component ① Fixing (SPEC-v7-KERNEL §1 table, §7). Commitments (salted
// sha256) and sealed material (ciphertexts, envelopes) are accepted only in
// their exact on-chain formats; plaintext never reaches the chain. Fixed
// material is written once and never replaced (the profile writes each slot
// in exactly one transition).
//
// The contract cannot decrypt anything; what it can check are lengths, which
// the formats of §7.3 / §7.4 determine exactly.

import {
  fail, hex32Arg, b64Arg, ceilDiv,
  HASH_LEN, SALT_LEN, NONCE_LEN, TAG_LEN, LEN_PREFIX, PAD_UNIT, MAX_PADDED_MESSAGE,
  ENV_S_LEN, ENV_C_LEN, ENV_R_LEN, RESP0_CT_LEN, RESP1_CT_LEN,
} from './params.js';

// §7.3 pad(): N = max(1024, ceil((|m| + 2) / 1024) * 1024) for "std" / "sub".
export function paddedLen(messageLen) {
  return Math.max(PAD_UNIT, ceilDiv(messageLen + LEN_PREFIX, PAD_UNIT) * PAD_UNIT);
}

// §6.1: |ciphertext|_max = |pad(salt || body)|_max + |nonce| + |tag|, with
// |body| = L (L_crit or L_sub) and |salt| = 16 (§2.2).
export function maxBucketCiphertextLen(limit) {
  return paddedLen(SALT_LEN + limit) + NONCE_LEN + TAG_LEN;
}

// The largest body limit whose padded form a u16be length prefix can describe.
export const MAX_BODY_LIMIT = MAX_PADDED_MESSAGE - SALT_LEN;

// A "std"/"sub" ciphertext is nonce || AEAD(pad(salt || body)): its length is
// 40 + a multiple of 1024 (at least one bucket) and at most the maximum for
// the pinned size limit.
export function checkBucketCiphertext(len, limit, name) {
  const body = len - NONCE_LEN - TAG_LEN;
  if (body < PAD_UNIT || body % PAD_UNIT !== 0) fail('E_LENGTH', `${name} must be 40 + a positive multiple of 1024 bytes`);
  if (len > maxBucketCiphertextLen(limit)) fail('E_LENGTH', `${name} exceeds the size limit pinned on the case`);
}

function fixedLenB64(x, name, want) {
  const b = b64Arg(x, name);
  if (b.len !== want) fail('E_LENGTH', `${name} must be exactly ${want} bytes`);
  return b;
}

// create_case material (§7.4, "at creation"): criteria hash, criteria
// ciphertext Enc(SK, "std", salt || criteria), and S's envelope of SK.
export function fixCriteria(args, lCrit) {
  const hash = hex32Arg(args.criteria_hash, 'criteria_hash');
  const ct = b64Arg(args.criteria_ct, 'criteria_ct');
  checkBucketCiphertext(ct.len, lCrit, 'criteria_ct');
  const env = fixedLenB64(args.env_s, 'env_s', ENV_S_LEN);
  return {
    record: { hash, ctLen: ct.len },
    blobs: { criteria_ct: ct.value, env_s: env.value },
    storageBytes: HASH_LEN + ct.len + ENV_S_LEN,
  };
}

// submit material (§7.4, "at submission"): the clerk's whole input.
export function fixSubmission(args, lSub) {
  const hash = hex32Arg(args.sub_hash, 'sub_hash');
  const ct = b64Arg(args.sub_ct, 'sub_ct');
  checkBucketCiphertext(ct.len, lSub, 'sub_ct');
  const envC = fixedLenB64(args.env_c, 'env_c', ENV_C_LEN);
  const envR = fixedLenB64(args.env_r, 'env_r', ENV_R_LEN);
  const lock = hex32Arg(args.lock, 'lock');
  return {
    record: { hash, ctLen: ct.len, lock },
    blobs: { sub_ct: ct.value, env_c: envC.value, env_r: envR.value },
    storageBytes: HASH_LEN + ct.len + ENV_C_LEN + ENV_R_LEN + HASH_LEN,
  };
}

// Response ciphertexts are packed to fixed sizes (§7.3, §10.3).
export function fixResponse(x, which) {
  const want = which === 'resp0' ? RESP0_CT_LEN : RESP1_CT_LEN;
  const name = which === 'resp0' ? 'response' : 'record';
  const b = fixedLenB64(x, name, want);
  return { blob: b.value, storageBytes: want };
}

export const blobKey = (caseId, slot) => `${caseId}:${slot}`;
