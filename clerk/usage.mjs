// Declared usage (SPEC §6.1 settlement step 1).
// The clerk declares, per call, the input and output token counts each
// rounded UP to 1,024-token units. The exact counts come from the signed
// response bytes (shared/response.mjs signedUsage), never from elsewhere, so
// a party can check declared == roundUp(signed) from the record (§9.1).

export const USAGE_UNIT = 1024;

export function roundUpTokens(n) {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`token count must be a non-negative integer, got ${n}`);
  return Math.ceil(n / USAGE_UNIT) * USAGE_UNIT;
}

// { in, out } exact -> { in, out } declared.
export function declareUsage(u) {
  return { in: roundUpTokens(u.in), out: roundUpTokens(u.out) };
}

export function sameUsage(a, b) {
  return !!a && !!b && a.in === b.in && a.out === b.out;
}
