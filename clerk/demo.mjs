// Offline end-to-end dry run of the clerk (no network, no secrets): the
// in-memory contract machine, real §7 cryptography, and the mock model.
//   1. registration (twice, to show idempotence);
//   2. inspection case, PASS -> k2 released after finality -> R decrypts;
//   3. inspection case, FAIL -> S appeals -> panel overturns via comparison -> k2;
//   4. adjudication case whose case file lacks the zeroth-decision record ->
//      formal PASS with usage [] (no model call).

import { createSandbox, NEAR, HOUR, R, S, FEES, CONTRACT } from './sandbox.mjs';
import { createClerk } from './service.mjs';
import { mockAi, verifyMockSignature, verdictContent, comparisonContent, blockOf, isComparison } from './mock-ai.mjs';
import { ctxOf, open, dec, fromB64, xor, fromHex, splitSalted, fromUtf8, LABELS } from '../shared/seal.mjs';
import { decodeRecord, inflate, payloadSlice } from '../shared/record.mjs';
import { parseVerdictResponse } from '../shared/response.mjs';
import { PRIMARY_MODEL } from './config.mjs';
import { ZEROTH_DECISION_HEADING } from './templates.mjs';

// The mock judges: the primary model passes a submission iff it mentions a
// price table; the panel always passes; the comparison overturns.
export function demoBehavior({ model, request }) {
  if (isComparison(request)) return { content: comparisonContent('OVERTURN', 'The primary reason says the price table is missing, but section 4 contains it; the FAIL is not supported by the record.') };
  if (model === PRIMARY_MODEL) {
    const ok = (blockOf(request, 'SUBMISSION') || '').includes('price table');
    return { content: verdictContent(ok ? 'PASS' : 'FAIL', ok ? 'All five competitors are covered and the price table is present.' : 'The criteria require a price table; none was found.') };
  }
  return { content: verdictContent('PASS', 'The report covers five competitors and includes their prices in section 4.') };
}

export async function runDemo({ log = console.log } = {}) {
  const sb = createSandbox();
  const ai = mockAi(demoBehavior);
  const clerk = createClerk({ chain: sb.clerk, ai, clerkSk: sb.keys.clerk.sk, verifySignature: verifyMockSignature, log: (s) => log(`  [clerk] ${s}`) });
  const summary = {};

  log('1. registration');
  summary.register1 = await sb.register({ log: (s) => log(`  ${s}`) });
  summary.register2 = await sb.register({ log: (s) => log(`  ${s}`) });

  log('2. inspection, PASS, k2 release');
  const a = sb.createCase({ criteria: '# Acceptance criteria\nA market report on five competitors, including a price table.' });
  sb.advance(HOUR);
  sb.submit(a, '# Deliverables\nReport on five competitors. Section 4: price table.');
  await clerk.tick();
  sb.advance(31 * 60 * 1000); // past the appeal deadline (W/2 = 30 min): final PASS
  await clerk.tick();
  const ca = sb.getCase(a);
  const ctx = ctxOf(CONTRACT, a);
  const K1 = open(sb.keys.R.sk, fromB64(sb.m.view('get_material', { case_id: a, slot: 'env_r' })), LABELS.wR, ctx);
  const K = xor(K1, fromHex(ca.k2));
  const opened = fromUtf8(splitSalted(dec(K, LABELS.sub, fromB64(sb.m.view('get_material', { case_id: a, slot: 'sub_ct' })), ctx)).body);
  const rec = decodeRecord(dec(K1, LABELS.resp0, fromB64(sb.m.view('get_material', { case_id: a, slot: 'response' })), ctx));
  const reason = parseVerdictResponse(inflate(payloadSlice(rec.payload, rec.header.z))).reason;
  summary.pass = { ending: ca.ending, k2: !!ca.k2, requesterDecrypted: opened, reason, fee1: ca.fee1, usage: ca.decision.usage };
  log(`  case ${a}: ${ca.ending}; R decrypted: ${JSON.stringify(opened.slice(0, 40))}...; reason: ${reason}`);

  log('3. inspection, FAIL, appeal, overturn');
  const b = sb.createCase({ criteria: '# Acceptance criteria\nA market report on five competitors, including a price table.' });
  sb.submit(b, '# Deliverables\nReport on five competitors. Section 4 lists each competitor and its price.');
  await clerk.tick();
  sb.appeal(b);
  sb.respond(b);
  await clerk.tick();
  await clerk.tick(); // k2 (the appeal decision is final at posting)
  const cb = sb.getCase(b);
  summary.appeal = { primary: cb.decision.verdict, result: cb.appeal.decision.result, ending: cb.ending, usage: cb.appeal.decision.usage, fee: cb.appeal.fee };
  log(`  case ${b}: primary ${cb.decision.verdict} -> appeal ${cb.appeal.decision.result}; ${cb.ending}`);

  log('4. adjudication, zeroth-decision record missing -> formal PASS');
  const calls = ai.calls.length;
  const c = sb.createCase({ templateId: 'adjudication', amount: 0n, criteria: '# Terms\nListings must not be counterfeit.\n(no zeroth-decision section)' });
  sb.submit(c, '# Evidence\nInvoice from the brand distributor.');
  await clerk.tick();
  const cc = sb.getCase(c);
  summary.formal = { verdict: cc.decision.verdict, usage: cc.decision.usage, charge: cc.fee1.charge, modelCalls: ai.calls.length - calls, heading: ZEROTH_DECISION_HEADING };
  log(`  case ${c}: ${cc.decision.verdict}, usage ${JSON.stringify(cc.decision.usage)}, charge ${cc.fee1.charge} (= base_1), model calls ${ai.calls.length - calls}`);

  summary.balances = { R: sb.m.balance(R).toString(), S: sb.m.balance(S).toString(), fees: sb.m.balance(FEES).toString() };
  log(`balances (yocto): R ${summary.balances.R}, S ${summary.balances.S}, fee account ${summary.balances.fees}; 1 NEAR = ${NEAR}`);
  return summary;
}
