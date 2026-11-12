// k2 auto-release (SPEC §5.3, §5.4, §7.6).
//
// The client rule, binding on the clerk: k2 is sent only after a FINALIZED
// block shows (a) the case final PASS with amount > 0 and (b)
//   block time <= final time + W/2 - release margin.
// NEAR publishes call arguments even when the call fails, so a k2 sent before
// finality or after the window leaks for nothing. The contract cannot
// enforce this; the client does. Default: refuse when the margin is not met
// (the case then ends PASS-unreleased, refunded, the submission unread and
// reusable). An explicit force flag overrides the margin only; after the
// window closes no k2 is ever sent, force or not (the contract would reject
// it and the value would leak).

import * as deadlines from '../contract/src/kernel/deadlines.js';
import { lockOf, toHex } from '../shared/seal.mjs';
import { openClerkEnvelope } from './formal.mjs';

// Pure decision. All times in ms.
//   now       finalized block time
//   deadline  final time + W/2 (the last instant a k2 finalize is valid)
//   marginMs  release safety margin (10 minutes, provisional)
//   force     explicit override flag
// Returns { action: 'send' | 'refuse' | 'expired', send: boolean, forced?: true, remainingMs, reason }.
export function decideK2Send({ now, deadline, marginMs, force = false }) {
  for (const [k, v] of Object.entries({ now, deadline, marginMs })) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${k} must be a finite number of ms`);
  }
  if (marginMs < 0) throw new RangeError('marginMs must be >= 0');
  const remainingMs = deadline - now;
  if (remainingMs < 0) {
    return { action: 'expired', send: false, remainingMs, reason: 'the release window has closed (now > final + W/2): a k2 finalize would be rejected and k2 would leak; the case can only be finalized without k2' };
  }
  if (remainingMs >= marginMs) {
    return { action: 'send', send: true, remainingMs, reason: `${remainingMs} ms remain in the release window, at least the ${marginMs} ms safety margin` };
  }
  if (force) {
    return { action: 'send', send: true, forced: true, remainingMs, reason: `forced: only ${remainingMs} ms remain, below the ${marginMs} ms safety margin` };
  }
  return { action: 'refuse', send: false, remainingMs, reason: `refused: only ${remainingMs} ms remain, below the ${marginMs} ms safety margin (pass the force flag to send anyway)` };
}

// Condition (a), from a case record read at finality "final" and the time of
// that finalized block. Returns { eligible: true, finalAt, deadline } or
// { eligible: false, wait?, why }.
export function releaseCheck(c, now) {
  if (c.phase === 'Closed') return { eligible: false, why: 'the case is closed' };
  if (!c.submission) return { eligible: false, why: 'no submission' };
  if (c.k2) return { eligible: false, why: 'k2 is already on-chain' };
  const fin = deadlines.finality(c, now);
  if (!fin) return { eligible: false, wait: true, why: 'the result is not final yet' };
  if (BigInt(c.amount) <= 0n) return { eligible: false, why: 'amount 0: no finalize pays the submitter, k2 is never sent' };
  if (fin.outcome !== 'PASS') return { eligible: false, why: `the final result is ${fin.outcome}` };
  return { eligible: true, finalAt: fin.finalAt, deadline: deadlines.releaseDeadline(c, fin) };
}

// One watcher step for one case.
// deps: { chain, clerkSk, marginMs, force?, log? }  (chain views are at finality "final")
export async function k2Step(deps, caseId) {
  const { chain, clerkSk, marginMs, force = false, log = () => {} } = deps;
  const now = await chain.finalBlockTimeMs();
  const c = await chain.view('get_case', { case_id: caseId });
  const st = releaseCheck(c, now);
  if (!st.eligible) return { sent: false, ...st };
  const d = decideK2Send({ now, deadline: st.deadline, marginMs, force });
  if (!d.send) {
    log(`case ${caseId}: k2 not sent: ${d.reason}`);
    return { sent: false, ...d };
  }
  const envC = await chain.view('get_material', { case_id: caseId, slot: 'env_c' });
  const keys = openClerkEnvelope({ contract: chain.contractId, caseId, clerkSk, envC });
  if (!keys) return { sent: false, why: 'the clerk envelope does not open; no k2 available' };
  if (lockOf(keys.K2) !== c.submission.lock) return { sent: false, why: 'sha256(K2) does not match the lock; not sending' };
  await chain.call('finalize', { case_id: caseId, k2: toHex(keys.K2) }, 0n);
  log(`case ${caseId}: k2 released (${d.reason})`);
  return { sent: true, ...d };
}
