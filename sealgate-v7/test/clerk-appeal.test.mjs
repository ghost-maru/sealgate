// The appeal bench (SPEC-v7-KERNEL §8.4, §6.1): integrity check, blind panel,
// comparison under the clear-error standard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { panelMajority, needsComparison, resolveAppeal } from '../clerk/appeal.mjs';
import { judgePrimary } from '../clerk/primary.mjs';
import { loadBlobs, loadTemplate } from '../clerk/service.mjs';
import { verifyMockSignature, verdictContent, isComparison } from '../clerk/mock-ai.mjs';
import { REGISTRATION, PANEL_MODEL } from '../clerk/config.mjs';
import { CONTRACT, NEAR, R, S } from '../clerk/sandbox.mjs';
import {
  setupClerk, staged, readAppealRecord, randomB64, comparisonCalls, eventOf,
  CRITERIA, SUBMISSION, PRIMARY_REASON,
} from './clerk-helpers.mjs';

const BASE_A = BigInt(REGISTRATION.base_a);
const finalize = (sb, id) => sb.m.call('finalize', { caller: 'carol.testnet', now: sb.clock() }, { case_id: id });

// Primary judgment, appeal, response, then one clerk tick for the review.
async function appealed(behavior, options = {}) {
  const ctx = await setupClerk({ behavior, options });
  const { sb, clerk } = ctx;
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  const { by } = sb.appeal(id);
  sb.respond(id);
  const before = ctx.ai.calls.length;
  const ev = await clerk.tick();
  return { ...ctx, id, by, before, ev, post: eventOf(ev, 'post_appeal_decision') };
}

test('pure: panel majority, comparison need, resolution table', () => {
  assert.equal(panelMajority(['PASS', 'PASS', 'FAIL']), 'PASS');
  assert.equal(panelMajority(['FAIL', 'PASS', 'FAIL']), 'FAIL');
  assert.throws(() => panelMajority(['PASS', 'PASS']));
  assert.equal(needsComparison({ integrityOk: true, panelComplete: true, panelVerdict: 'PASS', primaryVerdict: 'FAIL' }), true);
  assert.equal(needsComparison({ integrityOk: false, panelComplete: true, panelVerdict: 'PASS', primaryVerdict: 'FAIL' }), false);
  assert.equal(needsComparison({ integrityOk: true, panelComplete: true, panelVerdict: 'FAIL', primaryVerdict: 'FAIL' }), false);
  assert.equal(needsComparison({ integrityOk: true, panelComplete: false, panelVerdict: null, primaryVerdict: 'FAIL' }), false);
  const P = 'FAIL';
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, formalConfirmed: true }), { result: 'FAIL', path: 'formal_confirmed' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, formalOverride: 'PASS', integrityOk: false }), { result: 'PASS', path: 'formal_rerun' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, integrityOk: true, panelComplete: false }), { result: 'FAIL', path: 'panel_incomplete' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, integrityOk: false, panelComplete: true, panelVerdict: 'PASS' }), { result: 'PASS', path: 'integrity_failed' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, integrityOk: true, panelComplete: true, panelVerdict: 'FAIL' }), { result: 'FAIL', path: 'panel_agrees' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, integrityOk: true, panelComplete: true, panelVerdict: 'PASS', comparisonDecision: 'OVERTURN' }), { result: 'PASS', path: 'comparison_overturn' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, integrityOk: true, panelComplete: true, panelVerdict: 'PASS', comparisonDecision: 'UPHOLD' }), { result: 'FAIL', path: 'comparison_uphold' });
  assert.deepEqual(resolveAppeal({ primaryVerdict: P, integrityOk: true, panelComplete: true, panelVerdict: 'PASS', comparisonDecision: null }), { result: 'FAIL', path: 'comparison_incomplete' });
});

test('panel split against the primary -> the comparison decides (OVERTURN), k2 released, bonds to the appellant', async () => {
  const { sb, ai, clerk, id, by, before, post } = await appealed(staged({ primary: 'FAIL', panel: ['PASS', 'FAIL', 'PASS'], comparison: 'OVERTURN' }));
  assert.equal(by, S);
  assert.deepEqual([post.result, post.path, post.integrityOk], ['PASS', 'comparison_overturn', true]);
  const calls = ai.calls.slice(before);
  assert.equal(calls.filter((c) => !isComparison(c.request)).length, 3);
  assert.equal(comparisonCalls(ai).length, 1);
  assert.ok(calls.every((c) => c.model === PANEL_MODEL));
  const c = sb.getCase(id);
  assert.equal(c.appeal.decision.usage.panel.length, 3);
  assert.equal(c.appeal.decision.usage.comparison.length, 1);
  assert.ok(BigInt(c.appeal.fee.charge) > BASE_A);
  assert.equal(BigInt(c.appeal.fee.charge) + BigInt(c.appeal.fee.refund), BigInt(c.appeal.fee.deposit));

  // The record: readable with K1, all three stages, integrity ok.
  const rec = readAppealRecord(sb, id);
  assert.deepEqual([rec.header.k, rec.header.result, rec.header.panelVerdict, rec.header.comparison.decision], ['appeal', 'PASS', 'PASS', 'OVERTURN']);
  assert.equal(rec.header.integrity.ok, true);
  assert.equal(rec.header.panel.length, 3);

  // Final at posting: the clerk releases k2 on the next tick.
  const ev = await clerk.tick();
  assert.ok(eventOf(ev, 'k2_released'));
  const done = sb.getCase(id);
  assert.equal(done.ending, 'PASS_RELEASED');
  const bond = BigInt(done.bond);
  assert.equal(sb.m.balance(S), BigInt(done.fee1.refund) + BigInt(done.appeal.fee.refund) + 5n * NEAR + 2n * bond);
});

test('comparison UPHOLD keeps the primary verdict; the appellant bond moves to the respondent', async () => {
  const { sb, id, post } = await appealed(staged({ primary: 'FAIL', panel: ['PASS', 'PASS', 'FAIL'], comparison: 'UPHOLD' }));
  assert.deepEqual([post.result, post.path], ['FAIL', 'comparison_uphold']);
  finalize(sb, id);
  const done = sb.getCase(id);
  assert.equal(done.ending, 'FAIL');
  assert.equal(sb.m.balance(R), 5n * NEAR + 2n * BigInt(done.bond));
});

test('panel agrees with the primary -> upheld, comparison not called and not billed', async () => {
  const { sb, ai, id, post } = await appealed(staged({ primary: 'FAIL', panel: ['FAIL', 'FAIL', 'PASS'] }));
  assert.deepEqual([post.result, post.path], ['FAIL', 'panel_agrees']);
  assert.equal(comparisonCalls(ai).length, 0);
  assert.deepEqual(sb.getCase(id).appeal.decision.usage.comparison, []);
});

test('the blind panel never sees the primary verdict or reason; the comparison does', async () => {
  const { ai, before } = await appealed(staged({ primary: 'FAIL', panel: ['PASS', 'PASS', 'PASS'], comparison: 'OVERTURN' }));
  const calls = ai.calls.slice(before);
  for (const c of calls.filter((x) => !isComparison(x.request))) {
    const text = Buffer.from(c.requestBytes).toString('utf8');
    assert.equal(text.includes(PRIMARY_REASON), false);
    assert.equal(text.includes('PRIMARY JUDGMENT'), false);
    // same template and record as the primary, different model
    assert.equal(c.request.messages[0].content, ai.calls[0].request.messages[0].content);
    assert.equal(c.request.messages[1].content, ai.calls[0].request.messages[1].content);
    assert.equal(c.request.max_tokens, REGISTRATION.stages.panel.max_tokens);
  }
  const cmp = comparisonCalls(ai)[0];
  assert.ok(cmp.request.messages[1].content.includes(PRIMARY_REASON));
  assert.equal(cmp.request.max_tokens, REGISTRATION.stages.comparison.max_tokens);
});

test('integrity failure -> the panel verdict is adopted and the comparison is skipped', async () => {
  // The clerk's model said PASS, but FAIL is posted: the posted verdict does
  // not match the signed one.
  const { sb, ai, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS', panel: ['PASS', 'PASS', 'FAIL'] }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  const c0 = sb.getCase(id);
  const r = await judgePrimary({ contract: CONTRACT, clerkSk: sb.keys.clerk.sk, ai, verifySignature: verifyMockSignature, signers: sb.m.view('get_signers') }, c0, await loadBlobs(sb.clerk, id), await loadTemplate(sb.clerk, c0));
  assert.equal(r.verdict, 'PASS');
  await sb.clerk.call('post_decision', { ...r.post.args, verdict: 'FAIL' }, r.post.deposit);
  sb.appeal(id);
  sb.respond(id);
  const before = ai.calls.length;
  const ev = await clerk.tick();
  const post = eventOf(ev, 'post_appeal_decision');
  assert.deepEqual([post.result, post.path, post.integrityOk], ['PASS', 'integrity_failed', false]);
  assert.equal(ai.calls.length - before, 3);
  assert.equal(comparisonCalls(ai).length, 0);
  const c = sb.getCase(id);
  assert.deepEqual(c.appeal.decision.usage.comparison, []);
  const rec = readAppealRecord(sb, id);
  assert.ok(rec.header.integrity.failures.some((f) => f.includes('differs from the signed verdict')));
});

test('a formal FAIL confirmed by the re-run is upheld without any model call', async () => {
  const { sb, ai, clerk } = await setupClerk();
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION, { env_r: randomB64(80) }); // check 4 defect
  await clerk.tick();
  assert.equal(sb.getCase(id).decision.verdict, 'FAIL');
  sb.appeal(id);
  sb.respond(id);
  const ev = await clerk.tick();
  const post = eventOf(ev, 'post_appeal_decision');
  assert.deepEqual([post.result, post.path], ['FAIL', 'formal_confirmed']);
  assert.equal(ai.calls.length, 0);
  const c = sb.getCase(id);
  assert.deepEqual(c.appeal.decision.usage, { panel: [], comparison: [] });
  assert.equal(BigInt(c.appeal.fee.charge), BASE_A);
});

test('a panel that cannot produce 3 valid outputs leaves the primary standing', async () => {
  const panel = () => ({ content: 'not json' });
  const { sb, ai, id, before, post } = await appealed(staged({ primary: 'FAIL', panel }), { panelAttempts: 4 });
  assert.deepEqual([post.result, post.path], ['FAIL', 'panel_incomplete']);
  assert.equal(ai.calls.length - before, 4);
  assert.deepEqual(sb.getCase(id).appeal.decision.usage, { panel: [], comparison: [] });
});

test('invalid panel outputs are retried until three valid ones exist; only those are billed', async () => {
  const panel = (i) => (i === 1 ? { content: verdictContent('pass', 'lowercase verdict') } : { content: verdictContent('FAIL', `panel ${i}`) });
  const { sb, ai, id, before, post } = await appealed(staged({ primary: 'FAIL', panel }));
  assert.deepEqual([post.result, post.path], ['FAIL', 'panel_agrees']);
  assert.equal(ai.calls.length - before, 4);
  assert.equal(sb.getCase(id).appeal.decision.usage.panel.length, 3);
});
