// The clerk's formal inspection (SPEC-v7-KERNEL §7.5). Code only, no model.
//
//   checks 1-4   shared/seal.mjs formatCheck (envelope, criteria, submission,
//                lock + byte-exact requester envelope). Any failure -> FAIL.
//   required     the template's declared required inputs: (side, heading)
//   inputs       pairs whose heading must be present in the decrypted material.
//                A missing submission-side input -> FAIL (the submitter's
//                defect). A missing case-file-side input -> the result the
//                template declares (v7 defines only on_missing = PASS).
//
// Heading presence: the material, decoded as UTF-8, has a line that equals
// the heading string exactly once trailing spaces, tabs and CR are removed.
// Case-sensitive; leading whitespace is significant; a heading inside a
// longer line does not count.
//
// Order: checks 1-4, then case-file-side inputs, then submission-side inputs
// (a case-file defect predates the submission and only the requester can
// cure it, so it decides first; see the stage-2 report).

import {
  formatCheck, ctxOf, open, dec, splitSalted, fromB64, fromHex, toHex, xor, LABELS,
} from '../shared/seal.mjs';
import { CHECK1_RESPONSE_KEY } from '../shared/record.mjs';

export const CHECK_DESCRIPTIONS = Object.freeze({
  1: 'check 1 failed: the clerk envelope does not open to exactly 96 bytes (SK, K, K2)',
  2: 'check 2 failed: the criteria ciphertext does not open under SK, does not reproduce the criteria hash, or exceeds the case size limit',
  3: 'check 3 failed: the submission ciphertext does not open under K, does not reproduce the submission hash, or exceeds the case size limit',
  4: 'check 4 failed: sha256(K2) does not match the lock, or the requester envelope does not recompute byte for byte',
});

// Lossy, deterministic UTF-8 decoding (invalid sequences -> U+FFFD), so any
// byte string has exactly one text form in the request.
// Exported so the CLI (preflight, verify) rebuilds requests from the same text.
export const textOf = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);

export function hasHeading(text, heading) {
  return text.split('\n').some((line) => line.replace(/[ \t\r]+$/, '') === heading);
}

// Opens the clerk envelope; returns { SK, K, K2 } or null.
export function openClerkEnvelope({ contract, caseId, clerkSk, envC }) {
  try {
    const keys = open(clerkSk, fromB64(envC), LABELS.wC, ctxOf(contract, caseId));
    if (keys.length !== 96) return null;
    return { SK: keys.slice(0, 32), K: keys.slice(32, 64), K2: keys.slice(64, 96) };
  } catch {
    return null;
  }
}

// The on-chain material a case holds, in the shape formatCheck expects.
// c: the case record (get_case); blobs: { criteria_ct, sub_ct, env_c, env_r }.
export function materialOf(c, blobs) {
  return {
    criteria_hash: c.criteria.hash,
    criteria_ct: blobs.criteria_ct,
    sub_hash: c.submission.hash,
    sub_ct: blobs.sub_ct,
    env_c: blobs.env_c,
    env_r: blobs.env_r,
    lock: c.submission.lock,
  };
}

// Returns one of
//   { status: 'defect',  verdict: 'FAIL', check: 1..4, reason, responseKey }
//   { status: 'missing', verdict, side, heading, reason, responseKey }
//   { status: 'ok', responseKey (= K1), K2, data: { criteria, submission, criteriaHash, subHash, criteriaSalt, subSalt } }
// responseKey is the key the response is encrypted under: K1 = K xor K2, or
// the public CHECK1_RESPONSE_KEY when the envelope does not open (no K1).
export function formalInspection({ contract, caseId, clerkSk, requesterKeyHex, material, lCrit, lSub, requiredInputs = [] }) {
  const env = openClerkEnvelope({ contract, caseId, clerkSk, envC: material.env_c });
  const responseKey = env ? xor(env.K, env.K2) : CHECK1_RESPONSE_KEY;
  const r = formatCheck({ contract, caseId, clerkSk, requesterPk: fromHex(requesterKeyHex), material, lCrit, lSub });
  if (!r.ok) {
    return { status: 'defect', verdict: 'FAIL', check: r.defect, reason: `Formal defect, no model call: ${CHECK_DESCRIPTIONS[r.defect]}.`, responseKey };
  }

  const criteriaText = textOf(r.criteria);
  const submissionText = textOf(r.submission);
  for (const ri of requiredInputs.filter((x) => x.side === 'case_file')) {
    if (hasHeading(criteriaText, ri.heading)) continue;
    if (ri.on_missing !== 'PASS') throw new Error(`unsupported on_missing ${JSON.stringify(ri.on_missing)} for a case-file input`);
    return {
      status: 'missing', side: 'case_file', heading: ri.heading, verdict: 'PASS',
      reason: `Formal result, no model call: the case file lacks the required input "${ri.heading}" declared by the template; the template maps a missing case-file input to PASS (overturn).`,
      responseKey,
    };
  }
  for (const ri of requiredInputs.filter((x) => x.side === 'submission')) {
    if (hasHeading(submissionText, ri.heading)) continue;
    return {
      status: 'missing', side: 'submission', heading: ri.heading, verdict: 'FAIL',
      reason: `Formal defect, no model call: the submission lacks the required input "${ri.heading}" declared by the template.`,
      responseKey,
    };
  }

  const ctx = ctxOf(contract, caseId);
  const critSalt = splitSalted(dec(r.SK, LABELS.std, fromB64(material.criteria_ct), ctx)).salt;
  const subSalt = splitSalted(dec(r.K, LABELS.sub, fromB64(material.sub_ct), ctx)).salt;
  return {
    status: 'ok',
    responseKey,
    K2: r.K2,
    data: {
      criteria: criteriaText,
      submission: submissionText,
      criteriaHash: material.criteria_hash,
      subHash: material.sub_hash,
      criteriaSalt: toHex(critSalt),
      subSalt: toHex(subSalt),
    },
  };
}

// formalInspection bound to a case record.
export function inspectCase({ contract, clerkSk, c, blobs }) {
  return formalInspection({
    contract, caseId: c.id, clerkSk,
    requesterKeyHex: c.requesterKey,
    material: materialOf(c, blobs),
    lCrit: c.clerk.lCrit, lSub: c.clerk.lSub,
    requiredInputs: c.template.requiredInputs || [],
  });
}
