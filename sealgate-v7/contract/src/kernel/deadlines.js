// Component ⑥ Deadlines (SPEC-v7-KERNEL §1 table, §5.1, §5.2, §5.3, §8.5).
// Every stage has a deadline and a rule for what happens after it. Actions
// are valid up to and including their deadline (now <= deadline); expiry
// applies strictly after it (now > deadline), so the two never overlap.
//
// Time is the block timestamp in milliseconds; window lengths are whole
// seconds, stored in milliseconds, so W/2 is always an exact integer.

import { fail } from './params.js';

export const halfW = (c) => c.wMs / 2;
export const w1 = (c) => c.clerk.w1Sec * 1000;

export const submitDeadline = (c) => c.submitDeadline;                     // creation + submit window
export const decisionDeadline = (c) => c.submission.at + w1(c);           // submission + W1
export const appealDeadline = (c) => c.decision.at + halfW(c);            // decision + W/2
export const respondDeadline = (c) => c.appeal.at + halfW(c);             // appeal + W/2
export const reviewDeadline = (c) => c.appeal.respondedAt + w1(c);        // review start (respond) + W1

export function requireBefore(now, deadline, what) {
  if (now > deadline) fail('E_DEADLINE', `${what} deadline has passed`);
}

// Pre-judgment expiries (§5.1): no judgment exists, the case ends without one.
export function preJudgmentExpiry(c, now) {
  if (c.phase === 'AwaitingSubmission' && now > submitDeadline(c)) return 'UNSUBMITTED';
  if (c.phase === 'AwaitingDecision' && now > decisionDeadline(c)) return 'NO_DECISION';
  return null;
}

// Finality (§5.2): not a stored state, computed from the record and the time.
// Returns null while the decision can still change.
//   mode 'no_appeal'      final at the appeal deadline, primary verdict stands
//   mode 'default'        final at the respond deadline, primary verdict negated
//   mode 'appeal_decision' final at the posting time, the appeal result
//   mode 'clerk_silence'  final at the review deadline, primary verdict stands
export function finality(c, now) {
  const negate = (v) => (v === 'PASS' ? 'FAIL' : 'PASS');
  switch (c.phase) {
    case 'Decided': {
      const t = appealDeadline(c);
      return now > t ? { mode: 'no_appeal', outcome: c.decision.verdict, finalAt: t } : null;
    }
    case 'Appealed': {
      const t = respondDeadline(c);
      return now > t ? { mode: 'default', outcome: negate(c.decision.verdict), finalAt: t } : null;
    }
    case 'UnderReview': {
      const t = reviewDeadline(c);
      return now > t ? { mode: 'clerk_silence', outcome: c.decision.verdict, finalAt: t } : null;
    }
    case 'Reviewed':
      return { mode: 'appeal_decision', outcome: c.appeal.decision.result, finalAt: c.appeal.decision.at };
    default:
      return null;
  }
}

// The time split of the hash-locked release (§5.3): a k2 finalize is valid
// iff now <= finalAt + W/2; a k2-less finalize of a final PASS with amount > 0
// iff now > finalAt + W/2. Which one passes depends on the block time alone.
export const releaseDeadline = (c, fin) => fin.finalAt + halfW(c);
export const releaseOpen = (c, fin, now) => now <= releaseDeadline(c, fin);
