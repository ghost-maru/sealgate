// Component ② Judgment (SPEC §1 table, §6.1, §8.1, §8.2).
// Only the clerk pinned on the case posts a judgment, and a judgment is a
// verdict (PASS/FAIL) plus the encrypted signed response. The contract does
// not verify TEE signatures or hashes (§8.2); it checks the poster, the
// deadline, the formats and the declared usage.

import { fail, intArg, USAGE_UNIT, PRIMARY_MAX_CALLS } from './params.js';
import { fixResponse } from './fixing.js';

export function requireClerkCaller(c, caller) {
  if (caller !== c.clerk.account) fail('E_NOT_CLERK', 'only the clerk pinned on the case may post');
}

export function verdictArg(v, name) {
  if (v !== 'PASS' && v !== 'FAIL') fail('E_ARG', `${name} must be "PASS" or "FAIL"`);
  return v;
}

// Declared usage of one call: input and output token counts, each rounded up
// to 1,024-token units by the declarer (§6.1 step 1). Unrounded values are
// rejected: the declaration itself must not leak finer than the unit.
export function usageCall(x, name) {
  if (!x || typeof x !== 'object') fail('E_ARG', `${name} must be {in, out}`);
  const inT = intArg(x.in, `${name}.in`, 0);
  const outT = intArg(x.out, `${name}.out`, 0);
  if (inT % USAGE_UNIT !== 0 || outT % USAGE_UNIT !== 0) fail('E_USAGE_UNIT', `${name} must be declared in ${USAGE_UNIT}-token units`);
  return { in: inT, out: outT };
}

export function usageCalls(x, name, max) {
  const list = x === undefined ? [] : x;
  if (!Array.isArray(list)) fail('E_ARG', `${name} must be an array of {in, out}`);
  if (list.length > max) fail('E_TOO_MANY_CALLS', `${name} carries at most ${max} call(s)`);
  return list.map((u, i) => usageCall(u, `${name}[${i}]`));
}

// post_decision arguments: verdict, Enc(K1, "resp0", response) packed to its
// fixed size, and the usage of the call included in the response (0 calls
// for a formal-defect posting, otherwise 1).
export function parsePrimaryPosting(args) {
  const verdict = verdictArg(args.verdict, 'verdict');
  const resp = fixResponse(args.response, 'resp0');
  const usage = usageCalls(args.usage, 'usage', PRIMARY_MAX_CALLS);
  return { verdict, response: resp.blob, storageBytes: resp.storageBytes, usage };
}
