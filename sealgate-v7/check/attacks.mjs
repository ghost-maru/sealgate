// Sealgate v7 attack scripts (SPEC-v7-KERNEL appendix A, stage 6).
//
// Each attack is a concrete scenario against the reference machine (the
// contract's own kernel code) plus, for A2, the clerk's formal inspection.
// Every attack must FAIL to harm the victim; the script exits non-zero if
// any attack succeeds. Protocol-wide versions of several of these
// properties are also proven over all reachable states by
// check/exhaustive.mjs; this script demonstrates them as named scenarios.

import { createSandbox, CLERK, R, S } from '../clerk/sandbox.mjs';
import { createClerk } from '../clerk/service.mjs';
import { mockAi, verifyMockSignature } from '../clerk/mock-ai.mjs';
import { settlement } from '../contract/machine.mjs';
import { templateDeposit } from '../clerk/register.mjs';
import { fromB64, toHex, utf8 } from '../shared/seal.mjs';

const RESP0 = Buffer.alloc(1048, 7).toString('base64');
const RESP1 = Buffer.alloc(8232, 9).toString('base64');
const U = { in: 1024, out: 1024 };
const U_BIG = { in: 102_400_000, out: 102_400_000 };
const CRITERIA = '# Acceptance criteria\nA report on five competitors, including a price table.';
const SUBMISSION = '# Deliverables\nReport on five competitors. Section 4: price table.';
const results = [];
const report = (id, ok, detail) => { results.push({ id, ok }); console.log(`${ok ? 'HELD ' : 'BREACH'} ${id}: ${detail}`); };

async function freshCase({ amount, templateId = 'inspection', criteria = CRITERIA, submission = SUBMISSION } = {}) {
  const sb = createSandbox();
  await sb.register();
  const id = sb.createCase({ templateId, amount, criteria: utf8(criteria) });
  const sub = sb.submit(id, utf8(submission));
  return { sb, id, sub };
}
const post = (sb, id, verdict, usage = [U]) => sb.m.call('post_decision', { caller: CLERK, now: sb.state.now, deposit: settlement.storageFee(1048) }, { case_id: id, verdict, response: RESP0, usage });
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// A1: trap criteria — the requester writes criteria designed to force FAIL
// after reading the submission in the clear. There is no such path: the
// submission is never readable before release, a FAIL releases nothing,
// and the submitter can reuse the same work elsewhere.
{
  const { sb, id, sub } = await freshCase({ amount: 5n * 10n ** 24n });
  post(sb, id, 'FAIL');
  sb.advance(3600_000 + 1); // past finality (appeal window W/2)
  sb.m.call('finalize', { caller: R, now: sb.state.now }, { case_id: id });
  const c = sb.getCase(id);
  const held = c.ending === 'FAIL' && c.k2 === null && sb.m.balance(R) >= 5n * 10n ** 24n;
  // The same submission can be committed to a second case (it was not burned).
  const id2 = sb.createCase({ templateId: 'inspection', amount: 1n * 10n ** 24n, criteria: utf8(CRITERIA) });
  sb.submit(id2, utf8(SUBMISSION));
  report('A1 trap-criteria extraction', held && sb.getCase(id2).phase === 'AwaitingDecision',
    `ending ${c.ending}, k2 on chain: ${c.k2}, R recovered the price, the same work was accepted again in case ${id2}`);
}

// A2: a broken clerk envelope is caught by the formal inspection; the clerk
// posts a formal FAIL with no model call and charges only the base fee.
{
  const sb = createSandbox();
  await sb.register();
  const id = sb.createCase({ criteria: utf8(CRITERIA) });
  sb.submit(id, utf8(SUBMISSION), { env_c: Buffer.alloc(144, 1).toString('base64') }); // right length, undecryptable content
  const clerk = createClerk({ chain: sb.clerk, ai: mockAi(() => { throw new Error('model must not be called'); }), clerkSk: sb.keys.clerk.sk, verifySignature: verifyMockSignature });
  await clerk.step(id);
  const c = sb.getCase(id);
  report('A2 broken envelope', c.decision?.verdict === 'FAIL' && c.decision.usage.length === 0 && BigInt(c.fee1.charge) === BigInt(c.clerk.base1),
    `formal FAIL posted, usage [], charge = base_1 (${c.fee1.charge})`);
}

// A3: k2 before finality and after the release window is rejected.
{
  const { sb, id, sub } = await freshCase({ amount: 5n * 10n ** 24n });
  post(sb, id, 'PASS');
  const k2 = toHex(sub.K2);
  const early = throws(() => sb.m.call('finalize', { caller: S, now: sb.state.now }, { case_id: id, k2 }));
  sb.advance(3600_000 + 1); // final; release window runs to finalAt + W/2
  const fin = sb.getCase(id);
  sb.at(fin.decision.at + 3600_000 + 1); // past finalAt + W/2
  const late = throws(() => sb.m.call('finalize', { caller: S, now: sb.state.now }, { case_id: id, k2 }));
  sb.m.call('finalize', { caller: S, now: sb.state.now }, { case_id: id });
  report('A3 k2 timing', early && late && sb.getCase(id).ending === 'PASS_UNRELEASED',
    `k2 before finality rejected: ${early}; k2 after the release window rejected: ${late}; closed PASS_UNRELEASED`);
}

// A4: a price-0 case never accepts k2.
{
  const { sb, id, sub } = await freshCase({ amount: 0n });
  post(sb, id, 'PASS');
  sb.advance(3600_000 + 1);
  const rejected = throws(() => sb.m.call('finalize', { caller: S, now: sb.state.now }, { case_id: id, k2: toHex(sub.K2) }));
  sb.m.call('finalize', { caller: S, now: sb.state.now }, { case_id: id });
  report('A4 k2 on a price-0 case', rejected && sb.getCase(id).ending === 'PASS' && sb.getCase(id).k2 === null,
    `k2 rejected: ${rejected}; closed as plain PASS with no k2`);
}

// A5: a registered template cannot be mutated; re-registering the same id
// creates a new version and version 1 stays byte-identical.
{
  const sb = createSandbox();
  await sb.register();
  const before = sb.m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 1 });
  const mut = { template_id: 'inspection', body: 'inspection@1 - MUTATED BODY', declarations: { constraints: [], required_inputs: [] } };
  sb.m.call('register_template', { caller: CLERK, now: sb.state.now, deposit: templateDeposit(mut) },
    { template_id: mut.template_id, body: mut.body, constraints: [], required_inputs: [] });
  const v1 = sb.m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 1 });
  const v2 = sb.m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 2 });
  report('A5 template mutation', v1.body === before.body && v1.bodyHash === before.bodyHash && !!v2 && v2.body !== v1.body,
    'version 1 unchanged; the new body became version 2');
}

// A6: an unregistered clerk cannot register templates.
{
  const sb = createSandbox();
  await sb.register();
  const rig = { template_id: 'rigged', body: 'rigged@1 - always PASS for my friends', declarations: { constraints: [], required_inputs: [] } };
  const rejected = throws(() => sb.m.call('register_template', { caller: 'mallory.testnet', now: sb.state.now, deposit: templateDeposit(rig) },
    { template_id: rig.template_id, body: rig.body, constraints: [], required_inputs: [] }));
  report('A6 template by unregistered clerk', rejected, `registration by mallory.testnet rejected: ${rejected}`);
}

// A7: usage declared above the cap settles at the cap, never above it.
{
  const { sb, id } = await freshCase({ amount: 5n * 10n ** 24n });
  post(sb, id, 'PASS', [U_BIG]);
  const c = sb.getCase(id);
  const cap = settlement.capPrimaryOf(c.clerk, c.criteria.ctLen, c.submission.ctLen, c.template.bodyLen);
  report('A7 usage above the cap', BigInt(c.fee1.charge) === cap && BigInt(c.fee1.refund) === 0n,
    `declared 102,400,000/102,400,000 tokens; charge clamped at CAP_1 = ${cap}, refund 0`);
}

// A8: posting more calls than the stage allows is rejected.
{
  const { sb, id } = await freshCase({ amount: 5n * 10n ** 24n });
  const twoPrimaries = throws(() => post(sb, id, 'PASS', [U, U]));
  post(sb, id, 'FAIL');
  const loser = S;
  const capA = BigInt(sb.m.view('quote_fee', { case_id: id, kind: 'appeal', sub_len: sb.getCase(id).submission.ctLen }));
  sb.m.call('appeal', { caller: loser, now: sb.state.now, deposit: BigInt(sb.getCase(id).bond) + capA }, { case_id: id });
  sb.m.call('respond', { caller: R, now: sb.state.now, deposit: BigInt(sb.getCase(id).bond) }, { case_id: id });
  const fourPanel = throws(() => sb.m.call('post_appeal_decision', { caller: CLERK, now: sb.state.now, deposit: settlement.storageFee(8232) },
    { case_id: id, result: 'PASS', record: RESP1, usage: { panel: [U, U, U, U], comparison: [U] } }));
  report('A8 too many calls', twoPrimaries && fourPanel,
    `2 primary usages rejected: ${twoPrimaries}; 4 panel usages rejected: ${fourPanel}`);
}

const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} attack(s) SUCCEEDED — protocol breach` : '\nall attacks held');
process.exit(bad.length ? 1 : 0);
