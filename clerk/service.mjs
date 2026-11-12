// The clerk service loop: one tick scans the cases pinned to this clerk and
// does the next due action for each (SPEC §8.1, §8.4, §7.6):
//   AwaitingDecision (submitted, CAP_1 deposited)  -> primary judgment, post_decision
//   UnderReview      (appeal + respond done)       -> appeal bench, post_appeal_decision
//   final PASS with amount > 0, window open         -> k2 release (client rule)
//
// The service holds no state that matters: everything is re-derived from the
// chain each tick, so a restart loses nothing. Failures are logged and the
// case is retried on the next tick; nothing is ever posted that the
// pipelines did not produce from a valid, verified response (§5 silence).

import * as deadlines from '../contract/src/kernel/deadlines.js';
import { SERVICE_DEFAULTS } from './config.mjs';
import { judgePrimary } from './primary.mjs';
import { runAppealBench } from './appeal.mjs';
import { k2Step } from './k2.mjs';

const MATERIAL_SLOTS = ['criteria_ct', 'sub_ct', 'env_c', 'env_r'];

export async function loadBlobs(chain, caseId, slots = MATERIAL_SLOTS) {
  const out = {};
  for (const slot of slots) out[slot] = await chain.view('get_material', { case_id: caseId, slot });
  return out;
}

export async function loadTemplate(chain, c) {
  return chain.view('get_template', { clerk: c.template.clerk, template_id: c.template.id, version: c.template.version });
}

// chain: clerk-signing chain handle; ai: AI interface; clerkSk: X25519 sealing secret (Uint8Array)
export function createClerk({ chain, ai, clerkSk, verifySignature, options = {}, log = () => {} }) {
  const o = { ...SERVICE_DEFAULTS, ...options };
  const finished = new Set(); // case ids that need nothing more from this clerk

  const stopNear = (deadline) => async () => (await chain.finalBlockTimeMs()) > deadline - o.deadlineGuardMs;

  async function primary(c, signers) {
    const now = await chain.finalBlockTimeMs();
    const deadline = deadlines.decisionDeadline(c);
    if (now > deadline) return { action: 'skip', why: 'decision deadline passed (clerk silence)' };
    const [blobs, tpl] = [await loadBlobs(chain, c.id), await loadTemplate(chain, c)];
    const r = await judgePrimary({ contract: chain.contractId, clerkSk, ai, verifySignature, signers, maxAttempts: o.primaryAttempts, shouldStop: stopNear(deadline), log }, c, blobs, tpl);
    if (!r.post) { log(`case ${c.id}: nothing posted: ${r.why}`); return { action: 'silent', why: r.why }; }
    await chain.call(r.post.method, r.post.args, r.post.deposit);
    log(`case ${c.id}: post_decision ${r.verdict}, usage ${JSON.stringify(r.post.args.usage)}`);
    return { action: 'post_decision', verdict: r.verdict, usage: r.post.args.usage, formal: r.formal };
  }

  async function review(c, signers) {
    const now = await chain.finalBlockTimeMs();
    const deadline = deadlines.reviewDeadline(c);
    if (now > deadline) return { action: 'skip', why: 'review deadline passed (clerk silence)' };
    const blobs = await loadBlobs(chain, c.id, [...MATERIAL_SLOTS, 'response']);
    const tpl = await loadTemplate(chain, c);
    const r = await runAppealBench({
      contract: chain.contractId, clerkSk, ai, verifySignature, signers,
      panelAttempts: o.panelAttempts, comparisonAttempts: o.comparisonAttempts, shouldStop: stopNear(deadline), log,
    }, c, blobs, tpl);
    await chain.call(r.post.method, r.post.args, r.post.deposit);
    log(`case ${c.id}: post_appeal_decision ${r.result} (${r.path}), usage ${JSON.stringify(r.post.args.usage)}`);
    return { action: 'post_appeal_decision', result: r.result, path: r.path, usage: r.post.args.usage, integrityOk: r.integrity.ok };
  }

  async function handle(c, signers) {
    if (c.phase === 'AwaitingDecision') return primary(c, signers);
    if (c.phase === 'UnderReview') {
      // A review can also be final already (clerk silence); release first if so.
      const now = await chain.finalBlockTimeMs();
      if (now <= deadlines.reviewDeadline(c)) return review(c, signers);
    }
    if (['Decided', 'Appealed', 'UnderReview', 'Reviewed'].includes(c.phase)) {
      const r = await k2Step({ chain, clerkSk, marginMs: o.releaseMarginMs, force: o.forceK2, log }, c.id);
      if (r.sent) return { action: 'k2_released', forced: !!r.forced };
      if (r.action === 'refuse' || r.action === 'expired') return { action: `k2_${r.action}`, why: r.reason };
      if (r.wait) return { action: 'wait', why: r.why };
      return { action: 'done', why: r.why }; // final without a paying release: nothing left for the clerk
    }
    return { action: 'none' };
  }

  async function tick() {
    const events = [];
    const next = await chain.view('next_case_id', {});
    const signers = await chain.view('get_signers', {});
    for (let id = o.startCaseId; id < next; id++) {
      if (finished.has(id)) continue;
      let c;
      try { c = await chain.view('get_case', { case_id: id }); } catch (e) { log(`case ${id}: read failed: ${e.message}`); continue; }
      if (!c || c.clerk.account !== chain.accountId || c.phase === 'Closed') { finished.add(id); continue; }
      try {
        const ev = await handle(c, signers);
        if (ev.action === 'done' || ev.action === 'k2_expired' || ev.action === 'k2_released') finished.add(id);
        if (ev.action !== 'none' && ev.action !== 'wait') events.push({ caseId: id, ...ev });
      } catch (e) {
        log(`case ${id}: ${e.message}`);
        events.push({ caseId: id, action: 'error', why: e.message });
      }
    }
    return events;
  }

  // One case only: the same next-due action a tick would take for it. Used by
  // the `clerk-step` CLI command as a manual trigger of this pipeline.
  async function step(id) {
    const c = await chain.view('get_case', { case_id: id });
    if (!c) return { caseId: id, action: 'none', why: 'no such case' };
    if (c.clerk.account !== chain.accountId) return { caseId: id, action: 'none', why: `the case is pinned to clerk ${c.clerk.account}, not ${chain.accountId}` };
    if (c.phase === 'Closed') return { caseId: id, action: 'none', why: 'the case is closed' };
    const signers = await chain.view('get_signers', {});
    return { caseId: id, ...(await handle(c, signers)) };
  }

  async function run({ once = false, sleep = (ms) => new Promise((s) => setTimeout(s, ms)) } = {}) {
    for (;;) {
      try { await tick(); } catch (e) { log(`tick failed: ${e.message}`); }
      if (once) return;
      await sleep(o.pollMs);
    }
  }

  return { tick, step, run, options: o };
}
