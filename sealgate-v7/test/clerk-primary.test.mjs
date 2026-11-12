// Formal inspection and the primary judgment pipeline (SPEC-v7-KERNEL §7.5,
// §8.2, §6.1, §5.1), against the in-memory contract with real cryptography.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasHeading, inspectCase } from '../clerk/formal.mjs';
import { loadBlobs } from '../clerk/service.mjs';
import { templateDeposit } from '../clerk/register.mjs';
import { inflate, payloadSlice, CHECK1_RESPONSE_KEY } from '../shared/record.mjs';
import { parseVerdictResponse } from '../shared/response.mjs';
import { declareUsage } from '../clerk/usage.mjs';
import { REGISTRATION } from '../clerk/config.mjs';
import { ZEROTH_DECISION_HEADING } from '../clerk/templates.mjs';
import { verdictContent } from '../clerk/mock-ai.mjs';
import { CONTRACT, NEAR } from '../clerk/sandbox.mjs';
import { setupClerk, staged, readResponse, randomB64, eventOf, CRITERIA, SUBMISSION } from './clerk-helpers.mjs';

const BASE_1 = BigInt(REGISTRATION.base_1);
const DELIVERABLES = '# Deliverables';

async function withSubmissionInputTemplate(sb) {
  const body = 'Judge whether the delivered work meets the criteria.';
  const declarations = { constraints: [], required_inputs: [{ side: 'submission', heading: DELIVERABLES }] };
  await sb.clerk.call('register_template', { template_id: 'needs-deliverables', body, ...declarations }, templateDeposit({ body, declarations }));
}

test('hasHeading: whole-line, exact, trailing whitespace ignored', () => {
  const h = ZEROTH_DECISION_HEADING;
  assert.equal(hasHeading(`intro\n${h}\nbody`, h), true);
  assert.equal(hasHeading(`${h}  \t\r\nbody`, h), true);
  assert.equal(hasHeading(h, h), true);
  assert.equal(hasHeading(`#${h}\n`, h), false);
  assert.equal(hasHeading(` ${h}\n`, h), false);
  assert.equal(hasHeading(`see ${h} below`, h), false);
  assert.equal(hasHeading(h.toLowerCase(), h), false);
});

test('formal inspection: intact material passes checks 1-4 and yields the data', async () => {
  const { sb } = await setupClerk();
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  const c = sb.getCase(id);
  const f = inspectCase({ contract: CONTRACT, clerkSk: sb.keys.clerk.sk, c, blobs: await loadBlobs(sb.clerk, id) });
  assert.equal(f.status, 'ok');
  assert.equal(f.data.criteria, CRITERIA);
  assert.equal(f.data.submission, SUBMISSION);
  assert.equal(f.data.criteriaSalt, Buffer.from(sb.cases[id].critSalt).toString('hex'));
  assert.deepEqual(f.responseKey, sb.cases[id].sub.K1);
});

test('primary: a valid response is posted with its verdict and the rounded signed usage', async () => {
  const { sb, ai, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  const ev = await clerk.tick();
  const e = eventOf(ev, 'post_decision');
  assert.equal(e.verdict, 'PASS');
  assert.equal(ai.calls.length, 1);
  const call = ai.calls[0];
  assert.equal(call.model, REGISTRATION.primary_model);
  assert.equal(call.request.temperature, 0);
  assert.equal(call.request.max_tokens, REGISTRATION.stages.primary.max_tokens);
  const exact = { in: Math.ceil(call.requestBytes.length / 4), out: 48 };
  const c = sb.getCase(id);
  assert.deepEqual(c.decision.usage, [declareUsage(exact)]);
  assert.equal(c.decision.usage[0].out, 1024);

  // Settlement in the same transaction: charge = base_1 + p_in*min(in, IN_1) + p_out*min(out, M_1).
  const p = REGISTRATION.stages.primary;
  const IN1 = c.criteria.ctLen + c.submission.ctLen + c.template.bodyLen + p.overhead_tokens;
  const u = c.decision.usage[0];
  const charge = BASE_1 + BigInt(p.p_in) * BigInt(Math.min(u.in, IN1)) + BigInt(p.p_out) * BigInt(Math.min(u.out, p.max_tokens));
  assert.equal(BigInt(c.fee1.charge), charge);
  assert.equal(BigInt(c.fee1.charge) + BigInt(c.fee1.refund), BigInt(c.fee1.deposit));

  // The response record: R and S read it with K1; it carries the signed bytes.
  const rec = readResponse(sb, id);
  assert.equal(rec.header.k, 'primary');
  const parsed = parseVerdictResponse(inflate(payloadSlice(rec.payload, rec.header.z)));
  assert.equal(parsed.verdict, 'PASS');
});

test('primary: unparsable responses are retried and never counted', async () => {
  let n = 0;
  const behavior = () => (n++ === 0 ? { content: 'Sure! ' + verdictContent('FAIL', 'x') } : { content: verdictContent('PASS', 'ok') });
  const { sb, ai, clerk } = await setupClerk({ behavior });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  const ev = await clerk.tick();
  assert.equal(eventOf(ev, 'post_decision').verdict, 'PASS');
  assert.equal(ai.calls.length, 2);
  assert.equal(sb.getCase(id).decision.usage.length, 1); // only the counted call is billed
});

test('primary: unverifiable calls do not count (bad signature, gateway signature, no usage)', async () => {
  for (const bad of [{ badSignature: true }, { signatureKind: 'gateway' }, { usage: null }]) {
    const { sb, ai, clerk } = await setupClerk({ behavior: () => ({ content: verdictContent('PASS', 'ok'), ...bad }) });
    const id = sb.createCase({ criteria: CRITERIA });
    sb.submit(id, SUBMISSION);
    const ev = await clerk.tick();
    assert.ok(eventOf(ev, 'silent'), JSON.stringify(bad));
    assert.equal(ai.calls.length, 3);
    assert.equal(sb.getCase(id).phase, 'AwaitingDecision');
  }
});

test('primary: silence when no valid response exists -> nothing posted, NO_DECISION refunds', async () => {
  const { sb, clerk } = await setupClerk({ behavior: () => ({ content: verdictContent('PASS', 'cut'), finishReason: 'length' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  const sub = sb.submit(id, SUBMISSION);
  assert.ok(sub);
  const ev = await clerk.tick();
  assert.ok(eventOf(ev, 'silent'));
  const c = sb.getCase(id);
  assert.equal(c.decision, null);
  sb.advance(REGISTRATION.w1_sec * 1000 + 1);
  sb.m.call('finalize', { caller: 'carol.testnet', now: sb.clock() }, { case_id: id });
  const done = sb.getCase(id);
  assert.equal(done.ending, 'NO_DECISION');
  assert.equal(sb.m.balance('bob.testnet'), sb.cases[id].cap1); // CAP_1 returned in full
});

test('formal: submission-side required input missing -> FAIL, usage 0, no model call, base fee only', async () => {
  const { sb, ai, clerk } = await setupClerk();
  await withSubmissionInputTemplate(sb);
  const id = sb.createCase({ templateId: 'needs-deliverables', criteria: CRITERIA });
  sb.submit(id, 'Report on five competitors (no heading).\nsee # Deliverables inline');
  const ev = await clerk.tick();
  assert.equal(eventOf(ev, 'post_decision').verdict, 'FAIL');
  assert.equal(ai.calls.length, 0);
  const c = sb.getCase(id);
  assert.deepEqual(c.decision.usage, []);
  assert.equal(BigInt(c.fee1.charge), BASE_1);
  const rec = readResponse(sb, id);
  assert.deepEqual([rec.header.k, rec.header.verdict, rec.header.side, rec.header.heading], ['formal', 'FAIL', 'submission', DELIVERABLES]);
});

test('formal: submission-side required input present -> the model is called', async () => {
  const { sb, ai, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  await withSubmissionInputTemplate(sb);
  const id = sb.createCase({ templateId: 'needs-deliverables', criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  assert.equal(ai.calls.length, 1);
  assert.equal(sb.getCase(id).decision.verdict, 'PASS');
});

test('formal: adjudication case file without the zeroth-decision record -> PASS (overturn), usage 0', async () => {
  const { sb, ai, clerk } = await setupClerk();
  const id = sb.createCase({ templateId: 'adjudication', amount: 0n, criteria: '# Terms\nNo counterfeit listings.\n## Zeroth decisions (misspelled heading)' });
  sb.submit(id, '# Evidence\nInvoice.');
  const ev = await clerk.tick();
  assert.equal(eventOf(ev, 'post_decision').verdict, 'PASS');
  assert.equal(ai.calls.length, 0);
  const c = sb.getCase(id);
  assert.equal(c.phase, 'Decided'); // a primary judgment like any other
  assert.deepEqual(c.decision.usage, []);
  assert.equal(BigInt(c.fee1.charge), BASE_1); // the judgment fee goes to the fee account
  assert.equal(sb.m.balance('fees.testnet'), BASE_1);
  const rec = readResponse(sb, id);
  assert.deepEqual([rec.header.k, rec.header.verdict, rec.header.side], ['formal', 'PASS', 'case_file']);
});

test('formal: adjudication case file with the zeroth-decision record -> the model judges', async () => {
  const { sb, ai, clerk } = await setupClerk({ behavior: staged({ primary: 'FAIL' }) });
  const id = sb.createCase({ templateId: 'adjudication', amount: 0n, criteria: `# Terms\nNo counterfeit listings.\n\n${ZEROTH_DECISION_HEADING}\nAction: listing suspended. Grounds: counterfeit. Promise: restore within 24h if overturned.` });
  sb.submit(id, '# Evidence\nInvoice.');
  await clerk.tick();
  assert.equal(ai.calls.length, 1);
  assert.equal(sb.getCase(id).decision.verdict, 'FAIL');
  assert.ok(ai.calls[0].request.messages[0].content.includes('adjudication@1'));
});

test('formal: check 4 defect (requester envelope) -> FAIL without a model call', async () => {
  const { sb, ai, clerk } = await setupClerk();
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION, { env_r: randomB64(80) });
  await clerk.tick();
  assert.equal(ai.calls.length, 0);
  const c = sb.getCase(id);
  assert.equal(c.decision.verdict, 'FAIL');
  assert.deepEqual(c.decision.usage, []);
  const rec = readResponse(sb, id);
  assert.deepEqual([rec.header.k, rec.header.check], ['formal', 4]);
});

test('formal: check 1 defect (clerk envelope) -> FAIL, notice under the public check-1 key', async () => {
  const { sb, ai, clerk } = await setupClerk();
  const id = sb.createCase({ criteria: CRITERIA, amount: 2n * NEAR });
  sb.submit(id, SUBMISSION, { env_c: randomB64(144) });
  await clerk.tick();
  assert.equal(ai.calls.length, 0);
  assert.equal(sb.getCase(id).decision.verdict, 'FAIL');
  const rec = readResponse(sb, id, CHECK1_RESPONSE_KEY);
  assert.deepEqual([rec.header.k, rec.header.check], ['formal', 1]);
});

test('primary: the request is the pinned model, template and binding', async () => {
  const { sb, ai, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  const req = ai.calls[0].request;
  const sys = req.messages[0].content;
  const user = req.messages[1].content;
  const c = sb.getCase(id);
  assert.ok(sys.includes(`inspection@1 (sha256 ${c.template.bodyHash})`));
  assert.ok(user.startsWith(`ESCROW: ${CONTRACT}#${id}\nCONTEXT: sealgate7|${CONTRACT}|${id}\n`));
  assert.ok(user.includes(`<<<CRITERIA ${c.criteria.hash.slice(0, 16)}\n${CRITERIA}\nCRITERIA ${c.criteria.hash.slice(0, 16)}>>>`));
  assert.ok(user.includes(`<<<SUBMISSION ${c.submission.hash.slice(0, 16)}\n${SUBMISSION}\nSUBMISSION ${c.submission.hash.slice(0, 16)}>>>`));
});
