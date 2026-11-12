// Sealgate appellate protocol runner (SPEC v2 §2): integrity stage in code first,
// then blind re-judgment, then comparison under the clear-error standard.
// Returns a transcript object; the caller posts the resulting L1 claim on-chain.
import { buildInspectionRequest, buildBlindRequest, buildComparisonRequest, validateGrounds, MODELS } from '../shared/templates.mjs';
import { verifyIntegrity, verifyResponseBinding, parseVerdict, sha256hex } from '../shared/verify.mjs';
import { verifiedCall } from './ai.mjs';

export function parseComparison(responseBytes) {
  let resp;
  try { resp = JSON.parse(responseBytes.toString('utf8')); } catch { return { ok: false, why: 'response is not JSON' }; }
  const choice = resp.choices?.[0];
  if (!choice || choice.finish_reason !== 'stop') return { ok: false, why: 'finish_reason is not stop' };
  let v;
  try { v = JSON.parse(choice.message?.content ?? ''); } catch { return { ok: false, why: 'comparison content is not JSON' }; }
  const keys = Object.keys(v).sort().join(',');
  if (keys !== 'decision,reason') return { ok: false, why: `comparison keys are ${keys}` };
  if (v.decision !== 'UPHOLD' && v.decision !== 'OVERTURN') return { ok: false, why: 'decision not in {UPHOLD, OVERTURN}' };
  if (typeof v.reason !== 'string' || v.reason.length < 1 || v.reason.length > 400) return { ok: false, why: 'reason length outside 1..400' };
  return { ok: true, decision: v.decision, reason: v.reason };
}

const toClaim = (level, call, verdict) => ({
  level, verdict,
  reqHash: call.signature.text.split(':')[1],
  respHash: call.signature.text.split(':')[2],
  signature: call.signature.signature, signingAlgo: call.signature.signing_algo,
  signingAddress: call.signature.signing_address, signatureKind: call.signature.signature_kind,
});

// Run the primary inspection and return everything needed to post the L0 claim.
export async function runInspection(apiKey, { escrowRef = null, criteria, deliverable, salt = null, caseType = 'inspection' }) {
  const call = await verifiedCall(apiKey, MODELS.L0, buildInspectionRequest({ escrowRef, criteria, deliverable, salt, caseType }));
  const parsed = parseVerdict(call.respBytes);
  if (!parsed.ok) throw new Error(`L0 verdict unparsable: ${parsed.why}`);
  return { call, claim: toClaim(0, call, parsed.verdict), verdict: parsed.verdict, reason: parsed.reason };
}

// Panel decision (PARAMETERS.md §3.3): pure majority over parsed blind samples.
// Samples that fail parsing abstain. An exact tie among valid samples (only
// possible when one sample abstained) resolves to the L0 verdict: a split panel
// is, by definition, not clear evidence that the original verdict was wrong.
// Returns { verdict, chosenIndex } where chosenIndex indexes the ORIGINAL samples
// array (first sample agreeing with the panel verdict), or null when fewer than
// 2 valid samples exist (no quorum).
export function decidePanel(samples, tiebreakVerdict) {
  const valid = samples.map((s, i) => ({ ...s, i })).filter((s) => s.ok);
  if (valid.length < 2) return null;
  const passes = valid.filter((s) => s.verdict === 'PASS').length;
  const verdict = passes * 2 > valid.length ? 'PASS' : passes * 2 < valid.length ? 'FAIL' : tiebreakVerdict;
  const chosen = valid.find((s) => s.verdict === verdict);
  return { verdict, chosenIndex: chosen.i, validCount: valid.length };
}

// Run an appeal against an L0 claim.
// record: { criteria, deliverable, l0ResponseBytes, registeredSigners }
// Returns { integrityFailures, outcome: 'VOID'|'UPHOLD'|'OVERTURN', finalVerdict, blind, comparison, l1Claim }
export async function runAppeal(apiKey, { escrowRef = null, criteria, deliverable, l0Claim, l0ResponseBytes, registeredSigners, grounds, salt = null, l0Undecryptable = false, caseType = 'inspection' }) {
  const gFailures = validateGrounds(grounds);
  if (gFailures.length) throw new Error(`inadmissible grounds: ${gFailures.join('; ')}`);

  if (l0Undecryptable) {
    // Round-3 review N1: the L0 ciphertext cannot be decrypted with the two
    // parties' registered keys, so the claim is unverifiable BY CONSTRUCTION
    // — a claimant-side record failure, decided without the AI stages. The
    // caller still runs a blind judgment to pick the settlement verdict.
    return { integrityFailures: ['L0 response cannot be decrypted with the parties registered keys (claimant-side record failure)'], outcome: 'VOID', finalVerdict: null, blind: null, comparison: null, l1Claim: null };
  }

  // Stage 1: deterministic integrity over the disputed claim (code, not AI).
  const a = verifyIntegrity({ criteria, deliverable, escrowRef, claim: l0Claim, registeredSigners, salt, caseType });
  const b = verifyResponseBinding({ claim: l0Claim, responseBytes: l0ResponseBytes, registeredSigners });
  const integrityFailures = [...a.failures, ...b];
  if (integrityFailures.length) {
    return { integrityFailures, outcome: 'VOID', finalVerdict: null, blind: null, comparison: null, l1Claim: null };
  }

  // Stage 2: blind re-judgment by a 3-sample panel (the appellate model never sees
  // the L0 verdict or reason). All samples use the identical canonical request; the
  // L1 claim is backed by the first sample that agrees with the majority verdict.
  const blindReq = buildBlindRequest({ escrowRef, criteria, deliverable, salt, caseType });
  const sampleCalls = [];
  for (let i = 0; i < 3; i++) sampleCalls.push(await verifiedCall(apiKey, MODELS.L1, blindReq));
  const samples = sampleCalls.map((c) => { const p = parseVerdict(c.respBytes); return { ok: p.ok, verdict: p.verdict, reason: p.reason, chatId: c.chatId }; });
  const panel = decidePanel(samples, l0Claim.verdict);
  if (!panel) throw new Error('appellate panel reached no quorum (fewer than 2 valid blind verdicts)');
  const blindCall = sampleCalls[panel.chosenIndex];
  const blind = samples[panel.chosenIndex];

  // Stage 3: comparison under the clear-error standard.
  const l0Parsed = parseVerdict(l0ResponseBytes);
  const cmpCall = await verifiedCall(apiKey, MODELS.L1, buildComparisonRequest({
    criteria, deliverable,
    blindVerdictJson: JSON.stringify({ reason: blind.reason, verdict: blind.verdict }),
    originalVerdictJson: JSON.stringify({ reason: l0Parsed.reason, verdict: l0Parsed.verdict }),
    grounds, caseType,
  }));
  const comparison = parseComparison(cmpCall.respBytes);
  if (!comparison.ok) throw new Error(`comparison unparsable: ${comparison.why}`);

  const finalVerdict = comparison.decision === 'OVERTURN' ? blind.verdict : l0Claim.verdict;
  // The disposition is a statement about the L0 verdict's fate, and
  // settlement follows finalVerdict — so derive the outcome from the
  // verdicts, not from the comparison's wording (Fable review L-4: an
  // OVERTURN whose blind verdict equals the L0 verdict changes nothing,
  // and the transcript must not claim otherwise).
  const outcome = finalVerdict === l0Claim.verdict ? 'UPHOLD' : 'OVERTURN';
  // The L1 claim is backed by the panel's chosen signed response (the appellate
  // judgment of the deliverable itself); the comparison call is chained in the transcript.
  const l1Claim = toClaim(1, blindCall, finalVerdict);
  return {
    integrityFailures: [], outcome, finalVerdict,
    blind: {
      verdict: blind.verdict, reason: blind.reason, reqHash: sha256hex(blindReq),
      panel: samples.map((s) => ({ ok: s.ok, verdict: s.ok ? s.verdict : null, chatId: s.chatId })),
    },
    comparison: {
      decision: comparison.decision, reason: comparison.reason, chatId: cmpCall.chatId,
      // Signed evidence for the transcript (round-2 review F8): the comparison
      // response bytes and their TEE signature, so a party can verify that the
      // comparison the executor reports is the comparison that was signed.
      responseB64: cmpCall.respBytes.toString('base64'),
      signature: cmpCall.signature ? { text: cmpCall.signature.text, signature: cmpCall.signature.signature, signing_address: cmpCall.signature.signing_address } : null,
    },
    l1Claim, l1ResponseBytes: blindCall.respBytes,
  };
}
