// Primary judgment pipeline (SPEC-v7-KERNEL §7.5, §8.1, §8.2, §6.1, §5.1).
//
//   1. verify the template body against the hash pinned on the case;
//   2. formal inspection (code). A defect or a missing required input is
//      posted at once with usage [] (no model call; charge = base_1);
//   3. build the request: skeleton + pinned template body + pinned primary
//      model + pinned M_1, temperature 0, binding + salts;
//   4. call the model; a call counts only if verifiable and parsable (§8.2).
//      Invalid calls are retried a bounded number of times and never billed;
//   5. post_decision with the verdict, Enc(K1, "resp0", record) and the usage
//      of the one counted call rounded up to 1,024-token units.
//
// Silence: when no valid response can be produced, the result is
// { post: null } and nothing is posted; the contract's NO_DECISION expiry
// applies (§5.1). A verdict is never fabricated.
//
// The function is pure apart from the injected `ai` and `verifySignature`.

import { ctxOf, toB64, encResponse, RESP0_CT_LEN, sha256, utf8, toHex } from '../shared/seal.mjs';
import { buildJudgmentRequest } from '../shared/skeleton.mjs';
import { parseVerdictResponse } from '../shared/response.mjs';
import { encodePrimaryRecord, encodeFormalRecord, RESP0_MAX } from '../shared/record.mjs';
import { STORAGE_PRICE_PER_BYTE } from '../contract/src/kernel/params.js';
import { inspectCase } from './formal.mjs';
import { validatedCall } from './calls.mjs';
import { declareUsage } from './usage.mjs';

export const RESP0_DEPOSIT = BigInt(RESP0_CT_LEN) * STORAGE_PRICE_PER_BYTE;

// tpl: the registry entry (get_template). Throws when it is not the template
// pinned on the case.
export function verifyPinnedTemplate(c, tpl) {
  const pin = c.template;
  if (!tpl) throw new Error('E_TEMPLATE_MISSING: the pinned template is not in the registry');
  if (tpl.clerk !== pin.clerk || tpl.id !== pin.id || tpl.version !== pin.version) throw new Error('E_TEMPLATE_MISMATCH: registry entry is not the pinned (clerk, id, version)');
  const h = toHex(sha256(utf8(tpl.body)));
  if (h !== pin.bodyHash || h !== tpl.bodyHash) throw new Error('E_TEMPLATE_MISMATCH: sha256(body) differs from the hash pinned on the case');
  return { id: pin.id, version: pin.version, bodyHash: pin.bodyHash, body: tpl.body };
}

export function primaryRequest({ contract, c, template, data }) {
  return buildJudgmentRequest({
    contract, caseId: c.id,
    model: c.clerk.primaryModel,
    maxTokens: c.clerk.stages.primary.maxTokens,
    template, data,
  });
}

function postOf({ contract, c, verdict, plain, key, usage }) {
  return {
    method: 'post_decision',
    args: { case_id: c.id, verdict, response: toB64(encResponse(key, plain, ctxOf(contract, c.id))), usage },
    deposit: RESP0_DEPOSIT,
  };
}

// deps: { contract, clerkSk, ai, verifySignature, signers, maxAttempts?, shouldStop?, log? }
// c: case record; blobs: { criteria_ct, sub_ct, env_c, env_r }; tpl: registry entry.
// Returns { post, verdict, reason, formal, attempts } or { post: null, why, attempts }.
export async function judgePrimary(deps, c, blobs, tpl) {
  const { contract, clerkSk, ai, verifySignature, signers, maxAttempts = 3, shouldStop = async () => false, log = () => {} } = deps;
  const template = verifyPinnedTemplate(c, tpl);
  const f = inspectCase({ contract, clerkSk, c, blobs });

  if (f.status !== 'ok') {
    log(`case ${c.id}: formal result ${f.verdict} (${f.status}${f.check ? ` check ${f.check}` : ''}), no model call`);
    const plain = encodeFormalRecord(f);
    return { post: postOf({ contract, c, verdict: f.verdict, plain, key: f.responseKey, usage: [] }), verdict: f.verdict, reason: f.reason, formal: f.status, attempts: 0 };
  }

  const model = c.clerk.primaryModel;
  const reqBytes = primaryRequest({ contract, c, template, data: f.data });
  const whys = [];
  let attempts = 0;
  while (attempts < maxAttempts) {
    if (await shouldStop()) { whys.push('stopped: too close to the decision deadline'); break; }
    attempts++;
    const v = await validatedCall({ ai, model, reqBytes, signers, verifySignature, parse: parseVerdictResponse });
    if (!v.ok) { whys.push(v.why); log(`case ${c.id}: primary attempt ${attempts} not counted: ${v.why}`); continue; }
    const plain = encodePrimaryRecord({ reqHash: v.reqHash, signature: v.signature, respBytes: v.respBytes });
    if (plain.length > RESP0_MAX) {
      const why = `the signed response does not fit the 1008-byte response (${plain.length} > ${RESP0_MAX} bytes)`;
      whys.push(why); log(`case ${c.id}: primary attempt ${attempts} not counted: ${why}`);
      continue;
    }
    return {
      post: postOf({ contract, c, verdict: v.parsed.verdict, plain, key: f.responseKey, usage: [declareUsage(v.usage)] }),
      verdict: v.parsed.verdict, reason: v.parsed.reason, formal: null, attempts, exactUsage: v.usage,
    };
  }
  return { post: null, why: `no valid response after ${attempts} attempt(s): ${whys.join(' | ')}`, attempts };
}
