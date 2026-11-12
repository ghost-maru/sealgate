// Appeal bench (SPEC-v7-KERNEL §8.3, §8.4, §6.1). Stage structure reused from
// v5 cli/appellate.mjs (integrity in code -> blind panel -> comparison under
// the clear-error standard), minus the appellant's brief: v7 has no brief,
// the record is the whole argument (§8.3).
//
//   1. Integrity check (code), always against the clerk's primary judgment:
//      re-run the formal inspection; rebuild the primary request from the
//      skeleton, the pinned template body and the pinned primary model and
//      compare its hash; check the TEE signature and its signer against the
//      contract registry; check that the posted verdict equals the signed
//      verdict and that the declared usage equals the rounded signed usage.
//      A formal-defect posting whose re-run reproduces it is confirmed and
//      upheld without any model call (§8.4 step 1).
//   2. Blind panel: the pinned panel model, the same template, the same
//      request shape as the primary (it never contains the primary verdict or
//      reason); retried until 3 valid outputs; majority verdict. If 3 valid
//      outputs cannot be had in time, the primary judgment stands (§8.4 step 2).
//   3. If integrity failed: the panel verdict is adopted, no comparison.
//      If the panel agrees with the primary: upheld, no comparison.
//      Otherwise the comparison stage (panel model) decides under the
//      clear-error standard: OVERTURN -> panel verdict, UPHOLD -> primary.
//   4. post_appeal_decision: result, Enc(K1, "resp1", record) and the usage of
//      the counted calls (<= 3 panel, <= 1 comparison), each rounded up to
//      1,024-token units. Retried calls are neither recorded nor billed.

import { ctxOf, toB64, fromB64, dec, encAppealRecord, RESP1_CT_LEN, LABELS } from '../shared/seal.mjs';
import { buildJudgmentRequest, buildComparisonRequest } from '../shared/skeleton.mjs';
import { parseVerdictResponse, parseComparisonResponse, signedUsage } from '../shared/response.mjs';
import { decodeRecord, encodeRecord, payloadSlice, inflate, deflate, compactSig, CHECK1_RESPONSE_KEY, RESP1_MAX } from '../shared/record.mjs';
import { sha256hex, signatureText } from '../shared/tee.mjs';
import { STORAGE_PRICE_PER_BYTE } from '../contract/src/kernel/params.js';
import { inspectCase } from './formal.mjs';
import { verifyPinnedTemplate, primaryRequest } from './primary.mjs';
import { validatedCall, signedCallFailures } from './calls.mjs';
import { declareUsage, sameUsage } from './usage.mjs';

export const RESP1_DEPOSIT = BigInt(RESP1_CT_LEN) * STORAGE_PRICE_PER_BYTE;
export const PANEL_SIZE = 3;

// --------------------------------------------------------- pure decisions

export function panelMajority(verdicts) {
  if (verdicts.length !== PANEL_SIZE) throw new Error(`a panel verdict needs exactly ${PANEL_SIZE} valid outputs`);
  const passes = verdicts.filter((v) => v === 'PASS').length;
  return passes * 2 > verdicts.length ? 'PASS' : 'FAIL';
}

export function needsComparison({ integrityOk, panelComplete, panelVerdict, primaryVerdict }) {
  return !!integrityOk && !!panelComplete && panelVerdict !== primaryVerdict;
}

// The result of the review from the outcomes of the stages.
//   formalConfirmed  the primary was a formal result and the re-run reproduces it
//   formalOverride   integrity failed and the re-run formal inspection yields a
//                    formal result (no model judgment applies): that result
//   comparisonDecision 'UPHOLD' | 'OVERTURN' | null (not run, or no valid output)
export function resolveAppeal({ primaryVerdict, formalConfirmed = false, formalOverride = null, integrityOk, panelComplete, panelVerdict = null, comparisonDecision = null }) {
  if (formalConfirmed) return { result: primaryVerdict, path: 'formal_confirmed' };
  if (formalOverride) return { result: formalOverride, path: 'formal_rerun' };
  if (!panelComplete) return { result: primaryVerdict, path: 'panel_incomplete' };
  if (!integrityOk) return { result: panelVerdict, path: 'integrity_failed' };
  if (panelVerdict === primaryVerdict) return { result: primaryVerdict, path: 'panel_agrees' };
  if (comparisonDecision === 'OVERTURN') return { result: panelVerdict, path: 'comparison_overturn' };
  if (comparisonDecision === 'UPHOLD') return { result: primaryVerdict, path: 'comparison_uphold' };
  return { result: primaryVerdict, path: 'comparison_incomplete' };
}

// ------------------------------------------------------- integrity check

function openPrimaryRecord({ contract, c, responseBlob, responseKey }) {
  const ctx = ctxOf(contract, c.id);
  for (const key of [responseKey, CHECK1_RESPONSE_KEY]) {
    try { return decodeRecord(dec(key, LABELS.resp0, fromB64(responseBlob), ctx)); } catch { /* try the next key */ }
  }
  return null;
}

function sameFormal(h, f) {
  if (f.status === 'defect') return h.check === f.check && h.side === null;
  if (f.status === 'missing') return h.check === null && h.side === f.side && h.heading === f.heading;
  return false;
}

// Returns { ok, failures, formalConfirmed, primaryReason }.
export async function integrityCheck({ contract, c, f, template, responseBlob, signers, verifySignature }) {
  const failures = [];
  const posted = c.decision.verdict;
  const declared = c.decision.usage || [];
  const rec = responseBlob ? openPrimaryRecord({ contract, c, responseBlob, responseKey: f.responseKey }) : null;
  if (!rec) return { ok: false, failures: ['the primary response does not decrypt to a sealgate7 record'], formalConfirmed: false, primaryReason: null };
  const h = rec.header;

  if (h.k === 'formal') {
    if (f.status === 'ok') failures.push('the primary posted a formal result, but the formal inspection now passes');
    else if (!sameFormal(h, f)) failures.push('the posted formal result is not the one the formal inspection reproduces');
    if (h.verdict !== posted) failures.push(`the posted verdict ${posted} differs from the recorded formal result ${h.verdict}`);
    if (f.status !== 'ok' && h.verdict !== f.verdict) failures.push('the recorded formal verdict differs from the declared mapping');
    if (declared.length !== 0) failures.push('a formal result was posted with usage');
    return { ok: failures.length === 0, failures, formalConfirmed: failures.length === 0, primaryReason: h.reason || null };
  }
  if (h.k !== 'primary') return { ok: false, failures: [`unknown primary record kind ${JSON.stringify(h.k)}`], formalConfirmed: false, primaryReason: null };
  if (f.status !== 'ok') return { ok: false, failures: ['the primary called the model, but the formal inspection fails'], formalConfirmed: false, primaryReason: null };

  const model = c.clerk.primaryModel;
  const reqHash = sha256hex(primaryRequest({ contract, c, template, data: f.data }));
  if (reqHash !== h.req) failures.push('the primary request does not rebuild from the record (skeleton, pinned template, pinned model, binding, material)');

  let respBytes = null;
  try { respBytes = inflate(payloadSlice(rec.payload, h.z)); } catch { failures.push('the signed response bytes cannot be read from the record'); }
  if (!respBytes) return { ok: false, failures, formalConfirmed: false, primaryReason: null };
  const respHash = sha256hex(respBytes);
  const sig = h.sig || {};
  failures.push(...signedCallFailures({ model, reqHash: h.req, respHash, sig, signers }));
  let verified = false;
  try { verified = await verifySignature({ text: signatureText(model, h.req, respHash), signature: sig.sig, algo: sig.algo, address: sig.addr }); } catch { verified = false; }
  if (!verified) failures.push('the TEE signature over "<pinned primary model>:<req>:<resp>" does not verify');

  const p = parseVerdictResponse(respBytes);
  if (!p.ok) failures.push(`the signed response is not a valid verdict: ${p.why}`);
  else if (p.verdict !== posted) failures.push(`the posted verdict ${posted} differs from the signed verdict ${p.verdict}`);
  const u = signedUsage(respBytes);
  if (!u) failures.push('the signed response carries no usage');
  else if (declared.length !== 1 || !sameUsage(declared[0], declareUsage(u))) failures.push('the declared usage is not the signed usage rounded up to 1,024-token units');

  return { ok: failures.length === 0, failures, formalConfirmed: false, primaryReason: p.ok ? p.reason : null };
}

// ----------------------------------------------------------- the record

const clip = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n)}...` : s);

function callEntry(v, field) {
  return { req: v.reqHash, resp: v.respHash, sig: compactSig(v.signature), [field]: v.parsed[field], reason: v.parsed.reason, usage: v.usage, z: deflate(v.respBytes) };
}

// Packs the header and as many signed response bytes as fit into 8190 bytes:
// the comparison first, then panel members in order. Calls whose bytes do not
// fit keep their hashes, signature, parsed output and exact usage in the
// header ("z": null).
export function buildAppealRecord({ primaryVerdict, integrity, panel, panelVerdict, comparison, result, path }) {
  const included = new Set();
  const make = () => {
    const chunks = [];
    let off = 0;
    const ref = (e) => {
      if (!included.has(e)) return null;
      const r = { off, len: e.z.length };
      off += e.z.length;
      chunks.push(e.z);
      return r;
    };
    const strip = (e) => (e ? { req: e.req, resp: e.resp, sig: e.sig, ...(e.verdict !== undefined ? { verdict: e.verdict } : { decision: e.decision }), reason: e.reason, usage: e.usage, z: ref(e) } : null);
    const header = {
      k: 'appeal',
      primary: primaryVerdict,
      integrity: { ok: integrity.ok, formalConfirmed: !!integrity.formalConfirmed, failures: integrity.failures.slice(0, 8).map((s) => clip(s, 200)) },
      panel: panel.map(strip),
      panelVerdict,
      comparison: strip(comparison),
      result,
      path,
    };
    return encodeRecord(header, chunks.length ? new Uint8Array(Buffer.concat(chunks)) : new Uint8Array(0));
  };
  let out = make();
  if (out.length > RESP1_MAX) throw new Error(`the appeal record header alone exceeds ${RESP1_MAX} bytes`);
  for (const e of [comparison, ...panel].filter(Boolean)) {
    included.add(e);
    const t = make();
    if (t.length > RESP1_MAX) included.delete(e);
    else out = t;
  }
  return out;
}

// ------------------------------------------------------------- the bench

// deps: { contract, clerkSk, ai, verifySignature, signers, panelAttempts?, comparisonAttempts?, shouldStop?, log? }
// c: case record in phase UnderReview; blobs: { criteria_ct, sub_ct, env_c, env_r, response }; tpl: registry entry.
// Returns { post, result, path, integrity, panelVerdict, comparison } or { post: null, why }.
export async function runAppealBench(deps, c, blobs, tpl) {
  const { contract, clerkSk, ai, verifySignature, signers, panelAttempts = 9, comparisonAttempts = 3, shouldStop = async () => false, log = () => {} } = deps;
  const template = verifyPinnedTemplate(c, tpl);
  const primaryVerdict = c.decision.verdict;
  const f = inspectCase({ contract, clerkSk, c, blobs });

  // Stage 1: integrity (code).
  const integrity = await integrityCheck({ contract, c, f, template, responseBlob: blobs.response, signers, verifySignature });
  log(`case ${c.id}: integrity ${integrity.ok ? 'ok' : `FAILED (${integrity.failures.join('; ')})`}`);

  let panel = [];
  let panelVerdict = null;
  let comparison = null;
  let resolution;

  if (integrity.formalConfirmed) {
    resolution = resolveAppeal({ primaryVerdict, formalConfirmed: true });
  } else if (f.status !== 'ok') {
    // Integrity failed and the material yields a formal result: the formal
    // rule decides; no model judgment applies to defective material.
    resolution = resolveAppeal({ primaryVerdict, formalOverride: f.verdict, integrityOk: false });
  } else {
    // Stage 2: blind panel.
    const panelModel = c.clerk.panelModel;
    const reqP = buildJudgmentRequest({ contract, caseId: c.id, model: panelModel, maxTokens: c.clerk.stages.panel.maxTokens, template, data: f.data });
    let tries = 0;
    while (panel.length < PANEL_SIZE && tries < panelAttempts) {
      if (await shouldStop()) break;
      tries++;
      const v = await validatedCall({ ai, model: panelModel, reqBytes: reqP, signers, verifySignature, parse: parseVerdictResponse });
      if (v.ok) panel.push(callEntry(v, 'verdict'));
      else log(`case ${c.id}: panel attempt ${tries} not counted: ${v.why}`);
    }
    const panelComplete = panel.length === PANEL_SIZE;
    if (panelComplete) panelVerdict = panelMajority(panel.map((p) => p.verdict));

    // Stage 3: comparison, only when it can change the outcome.
    let comparisonDecision = null;
    if (needsComparison({ integrityOk: integrity.ok, panelComplete, panelVerdict, primaryVerdict })) {
      const reqC = buildComparisonRequest({
        contract, caseId: c.id, model: panelModel, maxTokens: c.clerk.stages.comparison.maxTokens, template, data: f.data,
        primary: { verdict: primaryVerdict, reason: integrity.primaryReason },
        panel: { verdict: panelVerdict, members: panel.map((p) => ({ verdict: p.verdict, reason: p.reason })) },
      });
      let ctries = 0;
      while (!comparison && ctries < comparisonAttempts) {
        if (await shouldStop()) break;
        ctries++;
        const v = await validatedCall({ ai, model: panelModel, reqBytes: reqC, signers, verifySignature, parse: parseComparisonResponse });
        if (v.ok) comparison = callEntry(v, 'decision');
        else log(`case ${c.id}: comparison attempt ${ctries} not counted: ${v.why}`);
      }
      comparisonDecision = comparison ? comparison.decision : null;
    }
    resolution = resolveAppeal({ primaryVerdict, integrityOk: integrity.ok, panelComplete, panelVerdict, comparisonDecision });
  }

  const plain = buildAppealRecord({ primaryVerdict, integrity, panel, panelVerdict, comparison, result: resolution.result, path: resolution.path });
  const usage = {
    panel: panel.map((p) => declareUsage(p.usage)),
    comparison: comparison ? [declareUsage(comparison.usage)] : [],
  };
  log(`case ${c.id}: appeal result ${resolution.result} (${resolution.path})`);
  return {
    post: {
      method: 'post_appeal_decision',
      args: { case_id: c.id, result: resolution.result, record: toB64(encAppealRecord(f.responseKey, plain, ctxOf(contract, c.id))), usage },
      deposit: RESP1_DEPOSIT,
    },
    result: resolution.result,
    path: resolution.path,
    integrity,
    panelVerdict,
    comparison: comparison ? comparison.decision : null,
  };
}
