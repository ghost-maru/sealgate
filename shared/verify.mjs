// Sealgate shared: the deterministic integrity stage (SPEC v2 §4).
// Pure code, never AI. Both parties hold the full record, so either can run this at
// any time and get the same result. Any failure here means the claim is fraudulent
// or corrupted — locally provable by the record holder, with nothing revealed.

import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import nacl from 'tweetnacl';
import { MODELS, buildInspectionRequest, buildBlindRequest } from './templates.mjs';

export const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
const normHex = (h) => (h || '').toLowerCase().replace(/^0x/, '');

// Amendment v1.1 verdict rule: content is JSON with keys exactly {reason, verdict},
// verdict in {PASS, FAIL}, reason a string of 1..400 chars, finish_reason "stop".
export function parseVerdict(responseBytes) {
  let resp;
  try { resp = JSON.parse(responseBytes.toString('utf8')); } catch { return { ok: false, why: 'response is not JSON' }; }
  const choice = resp.choices?.[0];
  if (!choice) return { ok: false, why: 'response has no choices' };
  if (choice.finish_reason !== 'stop') return { ok: false, why: `finish_reason is ${choice.finish_reason}, not stop` };
  let v;
  try { v = JSON.parse(choice.message?.content ?? ''); } catch { return { ok: false, why: 'verdict content is not JSON' }; }
  const keys = Object.keys(v).sort().join(',');
  if (keys !== 'reason,verdict') return { ok: false, why: `verdict keys are ${keys}` };
  if (v.verdict !== 'PASS' && v.verdict !== 'FAIL') return { ok: false, why: 'verdict not in {PASS, FAIL}' };
  if (typeof v.reason !== 'string' || v.reason.length < 1 || v.reason.length > 400) return { ok: false, why: 'reason length outside 1..400' };
  return { ok: true, verdict: v.verdict, reason: v.reason };
}

// Verify a claim's integrity against the record.
// claim: { level: 0|1, verdict, reqHash, respHash, signature, signingAlgo, signingAddress,
//          signatureKind } — as published on-chain (signature over hashes only).
// registeredSigners: iterable of lowercase hex addresses from attestation-matched reports.
// For level 1 the "request" is the blind re-judgment request (stage 2); the comparison
// call (stage 3) is chained by the CLI transcript, not by this function.
export function verifyIntegrity({ criteria, deliverable, escrowRef = null, claim, registeredSigners, salt = null, caseType = 'inspection' }) {
  const failures = [];
  const model = claim.level === 0 ? MODELS.L0 : MODELS.L1;
  // Exactly ONE template is tried: the caseType fixed on-chain at creation
  // (design review M5). A fallback to the other template would hand both
  // the claimant and the appellant a choice of adjudication standard.
  const reqBytes = claim.level === 0
    ? buildInspectionRequest({ escrowRef, criteria, deliverable, salt, caseType })
    : buildBlindRequest({ escrowRef, criteria, deliverable, salt, caseType });

  // Step 1: the claimed request hash must rebuild from THIS escrow's record.
  if (sha256hex(reqBytes) !== normHex(claim.reqHash)) failures.push('req_hash does not rebuild from the record (request binding failure)');

  // Steps 2–3 need the response bytes; callers pass them when available.
  return { failures, model, reqBytes };
}

export function verifyResponseBinding({ claim, responseBytes, registeredSigners }) {
  const failures = [];
  const model = claim.level === 0 ? MODELS.L0 : MODELS.L1;
  if (sha256hex(responseBytes) !== normHex(claim.respHash)) failures.push('resp_hash does not match the response bytes');
  const expectedText = `${model}:${normHex(claim.reqHash)}:${normHex(claim.respHash)}`;
  if (claim.signatureKind !== 'provider_tee') failures.push(`signature_kind is ${claim.signatureKind}, not provider_tee`);
  let sigOk = false;
  try {
    if (claim.signingAlgo === 'ecdsa') {
      const recovered = ethers.verifyMessage(Buffer.from(expectedText, 'utf8'), ethers.hexlify('0x' + normHex(claim.signature)));
      sigOk = normHex(recovered) === normHex(claim.signingAddress);
    } else if (claim.signingAlgo === 'ed25519') {
      sigOk = nacl.sign.detached.verify(Buffer.from(expectedText, 'utf8'), Buffer.from(normHex(claim.signature), 'hex'), Buffer.from(normHex(claim.signingAddress), 'hex'));
    }
  } catch { sigOk = false; }
  if (!sigOk) failures.push('TEE signature does not verify over "<MODEL>:<req_hash>:<resp_hash>"');
  const registry = new Set([...(registeredSigners || [])].map(normHex));
  if (!registry.has(normHex(claim.signingAddress))) failures.push('signer is not in the attestation-matched registry');
  const parsed = parseVerdict(responseBytes);
  if (!parsed.ok) failures.push(`verdict parse failed: ${parsed.why}`);
  else if (parsed.verdict !== claim.verdict) failures.push(`published verdict ${claim.verdict} != signed verdict ${parsed.verdict}`);
  return failures;
}

// Round-3 review N2 (round-4 R6: keyed on the escrow's own salted flag, not
// on deployment history): the bundle's salt encoding must be unambiguous. A
// salted commitment sha256(salt + "\n" + text) can also be produced by an
// UNSALTED commitment over text' = salt + "\n" + text, so an executor that
// accepts both encodings lets the appellant pass the commitment check with
// a shifted record whose canonical request then fails to rebuild — a
// manufactured VOID. Rule: a salted escrow requires a salt of exactly 32
// lowercase hex chars; an unsalted escrow requires null.
export function validateBundleSalt(salt, salted) {
  if (salted) {
    if (salt === null || salt === undefined) return 'salted escrow requires the bundle salt';
    if (!/^[0-9a-f]{32}$/.test(salt)) return 'bundle salt must be 32 lowercase hex chars';
    return null;
  }
  if (salt !== null && salt !== undefined) return 'unsalted escrow takes no salt';
  return null;
}
