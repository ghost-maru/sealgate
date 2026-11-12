// Component ③ Appeal (SPEC-v7-KERNEL §1 table, §8.3, §8.4). One appeal per
// case, by the side the primary judgment went against; the favored side
// answers by posting its bond. The review itself (integrity check, blind
// panel, comparison under the clear-error standard) runs at the clerk; the
// contract records the result and the usage of the calls in the record.

import { fail, PANEL_MAX_CALLS, COMPARISON_MAX_CALLS } from './params.js';
import { verdictArg, usageCalls } from './judgment.js';
import { fixResponse } from './fixing.js';

// The disadvantaged side appeals: PASS went against R, FAIL against S.
export function appellantOf(c) {
  return c.decision.verdict === 'PASS' ? c.requester : c.submitter;
}
export function respondentOf(c) {
  return c.decision.verdict === 'PASS' ? c.submitter : c.requester;
}

export function requireAppellant(c, caller) {
  if (caller !== appellantOf(c)) fail('E_NOT_APPELLANT', 'only the side the primary judgment went against may appeal');
}
export function requireRespondent(c, caller) {
  if (caller !== respondentOf(c)) fail('E_NOT_RESPONDENT', 'only the favored side may respond');
}

// post_appeal_decision arguments: result, Enc(K1, "resp1", record) packed to
// 8192, and the usage of the calls included in the record: at most 3 panel
// calls and at most 1 comparison call (none when the comparison was skipped).
export function parseAppealPosting(args) {
  const result = verdictArg(args.result, 'result');
  const rec = fixResponse(args.record, 'resp1');
  const u = args.usage === undefined ? {} : args.usage;
  if (!u || typeof u !== 'object' || Array.isArray(u)) fail('E_ARG', 'usage must be {panel: [...], comparison: [...]}');
  for (const k of Object.keys(u)) if (k !== 'panel' && k !== 'comparison') fail('E_ARG', `unknown usage stage ${k}`);
  const usage = {
    panel: usageCalls(u.panel, 'usage.panel', PANEL_MAX_CALLS),
    comparison: usageCalls(u.comparison, 'usage.comparison', COMPARISON_MAX_CALLS),
  };
  return { result, record: rec.blob, storageBytes: rec.storageBytes, usage };
}

// How the appeal ended, for the bond rule of §6: only "the result equals the
// primary decision or not" matters for a posted review (§8.4 step 4).
//   'none'       no appeal
//   'default'    respondent never posted a bond (appellant wins, no review)
//   'silence'    clerk silent in review (primary stands, no review)
//   'overturned' review posted, result differs from the primary decision
//   'upheld'     review posted, result equals the primary decision
export function appealEnding(c, fin) {
  if (!c.appeal) return 'none';
  if (fin.mode === 'default') return 'default';
  if (fin.mode === 'clerk_silence') return 'silence';
  return c.appeal.decision.result !== c.decision.verdict ? 'overturned' : 'upheld';
}
