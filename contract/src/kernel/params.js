// Fixed values of the profile (SPEC §10.3, §7.3, §7.4, §10.1,
// §10.2) and the small helpers every kernel module shares (errors, argument
// parsing, byte-length arithmetic).
//
// Runtime constraints: this file is bundled into the NEAR contract (QuickJS),
// so it must not use TextEncoder, Buffer, atob or any Node API. BigInt is
// available in both hosts.

export const NEAR = 10n ** 24n;

// --- storage (§10.3) ---
export const STORAGE_PRICE_PER_BYTE = 10n ** 19n; // 0.00001 NEAR per byte, paid by the writer, never refunded
// Blobs are stored on chain as base64 strings, so storage is charged on the
// stored length, not the decoded length: a padded base64 string is
// 4 * ceil(rawLen / 3) bytes (ASCII). Charging the decoded length would
// leave the ~1/3 expansion to the contract account.
export const b64StoredLen = (rawLen) => 4 * Math.ceil(rawLen / 3);
export const RECORD_FEE = 3n * 10n ** 22n;        // 0.03 NEAR fixed record fee per case

// --- material formats (§7.3, §7.4) ---
export const HASH_LEN = 32;     // sha256 commitments, the lock, k2
export const KEY_LEN = 32;      // X25519 sealing keys
export const SALT_LEN = 16;     // §2.2
export const NONCE_LEN = 24;    // Enc: leading random nonce
export const TAG_LEN = 16;      // XChaCha20-Poly1305 tag
export const LEN_PREFIX = 2;    // pad(): u16be length prefix
export const PAD_UNIT = 1024;   // std/sub buckets
export const MAX_PADDED_MESSAGE = 65535; // a u16be prefix cannot describe longer messages
export const RESP0_PAD = 1008;  // primary response padded size (§10.3)
export const RESP1_PAD = 8192;  // appeal record padded size (§10.3)
export const RESP0_CT_LEN = NONCE_LEN + RESP0_PAD + TAG_LEN; // 1048
export const RESP1_CT_LEN = NONCE_LEN + RESP1_PAD + TAG_LEN; // 8232
export const ENV_S_LEN = 32 + 32 + TAG_LEN;      // Seal(S, SK, "wSkS"): E || AEAD(SK)       = 80
export const ENV_C_LEN = 32 + 3 * 32 + TAG_LEN;  // Seal(C, SK||K||K2, "wC")                 = 144
export const ENV_R_LEN = 32 + 32 + TAG_LEN;      // Seal(R, K1, "wR")                        = 80

// --- judgment / appeal (§6.1, §8.4, §10.3) ---
export const PRIMARY_MAX_CALLS = 1;
export const PANEL_MAX_CALLS = 3;      // blind panel runs 3 times
export const COMPARISON_MAX_CALLS = 1;
export const USAGE_UNIT = 1024;        // declared usage is rounded up to 1,024-token units

// --- creator parameters (§10.1) and clerk registration bounds (§10.2), seconds ---
export const HOUR_S = 3600;
export const DAY_S = 86400;
export const W_DEFAULT_S = 24 * HOUR_S;
export const W_MIN_S = HOUR_S;
export const W_MAX_S = 30 * DAY_S;
export const SUBMIT_MIN_S = HOUR_S;
export const SUBMIT_MAX_S = 180 * DAY_S;
export const W1_MIN_S = 30 * 60;
export const W1_MAX_S = 7 * DAY_S;
export const BOND_DEFAULT_PERCENT = 20n;  // default bond = max(floor, 20% of the amount)
export const ZERO_AMOUNT_BOND_CAP = NEAR; // bond cap when the amount is 0: max(floor, 1 NEAR)

// --- template declarations (§5.5, §7.5) ---
export const CONSTRAINT_AMOUNT_ZERO = 'amount_zero'; // the only constraint kind defined in v7
export const INPUT_SIDES = ['case_file', 'submission'];

// --- errors ---
// Every rejection is an Error whose message starts with a stable code. The
// spec names one code (E_K2_UNEXPECTED, §5.4); the rest are implementation codes.
export function fail(code, detail) {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

// --- argument parsing (strict: near-sdk-js passes JSON through unchecked) ---
const ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function accountArg(x, name) {
  if (typeof x !== 'string' || x.length < 2 || x.length > 64 || !ACCOUNT_RE.test(x)) fail('E_ARG', `${name} must be a NEAR account id`);
  return x;
}
export function intArg(x, name, min, max) {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) fail('E_ARG', `${name} must be an integer`);
  if (min !== undefined && x < min) fail('E_RANGE', `${name} must be >= ${min}`);
  if (max !== undefined && x > max) fail('E_RANGE', `${name} must be <= ${max}`);
  return x;
}
export function yoctoArg(x, name) {
  if (typeof x !== 'string' || !/^(0|[1-9][0-9]*)$/.test(x)) fail('E_ARG', `${name} must be a decimal integer string (yocto)`);
  return BigInt(x);
}
export function strArg(x, name, maxLen) {
  if (typeof x !== 'string' || x.length === 0 || x.length > maxLen) fail('E_ARG', `${name} must be a string of 1..${maxLen} chars`);
  return x;
}
const HEX64 = /^[0-9a-f]{64}$/;
export function hex32Arg(x, name) {
  if (typeof x !== 'string' || !HEX64.test(x)) fail('E_ARG', `${name} must be 32 bytes as 64 lowercase hex chars`);
  return x;
}
// Byte length of a canonical, padded standard base64 string.
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
export function b64Arg(x, name) {
  if (typeof x !== 'string' || x.length === 0 || x.length % 4 !== 0 || !B64.test(x)) fail('E_ARG', `${name} must be padded standard base64`);
  const pad = x.endsWith('==') ? 2 : x.endsWith('=') ? 1 : 0;
  return { value: x, len: (x.length / 4) * 3 - pad };
}

// --- byte helpers ---
export function utf8Bytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00); i++; }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // lone surrogate -> U+FFFD, as TextEncoder does
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}
export function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

export const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
export const ceilDivBig = (a, b) => (a + b - 1n) / b;
export const minBig = (a, b) => (a < b ? a : b);
export const maxBig = (a, b) => (a > b ? a : b);
