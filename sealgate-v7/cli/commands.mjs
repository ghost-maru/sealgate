// Sealgate v7 CLI commands (SPEC-v7-KERNEL appendix A, stage 3).
//
// Every command is an async function (ctx, options) -> result object. It
// prints human-readable lines through ctx.out and throws CliError (with an
// exit code, cli/util.mjs EXIT) when it refuses or a check fails.
//
// ctx:
//   chain          clerk/chain.mjs interface, signing as ctx.account
//                  (MachineChain offline, nearChain live). All chain access
//                  goes through it.
//   account        the acting NEAR account
//   sealKey        { sk, pk } X25519 sealing key of the account, or null
//   casesDir       root of the local case material (cli/store.mjs)
//   out(line)      printer
//   verifySignature  TEE verifier: shared/tee.mjs verifyTeeSignature live;
//                    the mock verifier only in the offline sandbox
//   marginMs       k2 release safety margin (clerk/config.mjs RELEASE_MARGIN_MS)
//   makeClerk()    -> clerk service (clerk/service.mjs) for clerk-step
//
// Protocol logic is reused, never re-derived: deposits and fees come from the
// kernel's own settlement/fixing functions and the contract's quote_fee view;
// the k2 rule is clerk/k2.mjs (releaseCheck + decideK2Send); request rebuilds
// use shared/skeleton.mjs through clerk/primary.mjs; formal-inspection
// helpers come from clerk/formal.mjs.

import * as settlement from '../contract/src/kernel/settlement.js';
import * as fixing from '../contract/src/kernel/fixing.js';
import * as registry from '../contract/src/kernel/registry.js';
import * as deadlines from '../contract/src/kernel/deadlines.js';
import { closingTransition } from '../contract/src/kernel/profile-v7.js';
import { RECORD_FEE, W_MIN_S, W_MAX_S, SUBMIT_MIN_S, SUBMIT_MAX_S, W_DEFAULT_S } from '../contract/src/kernel/params.js';
import {
  ctxOf, open, dec, seal, xor, commit, lockOf, eROf, splitSalted, buildCriteria, buildSubmission,
  bucketCiphertextLen, newSalt, fromB64, fromHex, toHex, utf8, concat, keypair, SALT_LEN, LABELS,
} from '../shared/seal.mjs';
import { decodeRecord, inflate, payloadSlice, CHECK1_RESPONSE_KEY } from '../shared/record.mjs';
import { parseVerdictResponse, parseComparisonResponse, signedUsage } from '../shared/response.mjs';
import { sha256hex, signatureText } from '../shared/tee.mjs';
import { buildJudgmentRequest, buildComparisonRequest } from '../shared/skeleton.mjs';
import { hasHeading, textOf, openClerkEnvelope } from '../clerk/formal.mjs';
import { verifyPinnedTemplate, primaryRequest } from '../clerk/primary.mjs';
import { signedCallFailures } from '../clerk/calls.mjs';
import { declareUsage, sameUsage } from '../clerk/usage.mjs';
import { decideK2Send, releaseCheck } from '../clerk/k2.mjs';
import { panelMajority, resolveAppeal } from '../clerk/appeal.mjs';
import { RELEASE_MARGIN_MS } from '../clerk/config.mjs';
import { storeFor } from './store.mjs';
import { CliError, EXIT, yoctoAndNear, formatNear, iso, span, short, equalBytes } from './util.mjs';

// ------------------------------------------------------------- shared

export function roleOf(c, account) {
  if (account === c.requester) return 'R';
  if (account === c.submitter) return 'S';
  if (account === c.clerk.account) return 'C';
  return null;
}

export async function getCase(chain, caseId) {
  let c;
  try { c = await chain.view('get_case', { case_id: caseId }); } catch (e) { throw new CliError(`case ${caseId}: ${e.message}`); }
  if (!c) throw new CliError(`no case ${caseId}`);
  return c;
}
const blob = (chain, caseId, slot) => chain.view('get_material', { case_id: caseId, slot });
const lensOf = (c) => ({ crit: c.criteria.ctLen, sub: c.submission.ctLen, tpl: c.template.bodyLen });
const tplName = (t) => `${t.id}@${t.version}`;

function requireSealKey(ctx, why) {
  if (!ctx.sealKey) throw new CliError(`a sealing key is required ${why} (SEALGATE_SEAL_KEY_FILE, or a sandbox account with a key)`);
  return ctx.sealKey;
}

async function sendCall(ctx, method, args, deposit) {
  try {
    return await ctx.chain.call(method, args, deposit);
  } catch (e) {
    throw new CliError(`${method} transaction failed: ${e && e.message ? e.message : e}`, EXIT.CHECK_FAILED);
  }
}

// submit deposit = CAP_1 (the contract's quote_fee for the actual ciphertext
// length) + storage of the written bytes (the kernel's own fixSubmission).
async function submitQuote(chain, c, args) {
  const fixed = fixing.fixSubmission(args, c.clerk.lSub);
  const cap1 = BigInt(await chain.view('quote_fee', { case_id: c.id, kind: 'primary', sub_len: fixed.record.ctLen }));
  const storage = settlement.storageFee(fixed.storageBytes);
  return { cap1, storage, storageBytes: fixed.storageBytes, ctLen: fixed.record.ctLen, deposit: cap1 + storage };
}

// The submitter's SK: local copy, else opened from the on-chain envelope env_s.
async function submitterSK(ctx, c, store) {
  const local = store.read('SK');
  if (local) return local;
  const { sk } = requireSealKey(ctx, 'to open the criteria envelope');
  try {
    return open(sk, fromB64(await blob(ctx.chain, c.id, 'env_s')), LABELS.wSkS, ctxOf(ctx.chain.contractId, c.id));
  } catch {
    throw new CliError('the criteria envelope (env_s) does not open with your sealing key: it was sealed to another key; you cannot read the criteria of this case', EXIT.CHECK_FAILED);
  }
}

function printTerms(ctx, c, now) {
  const o = ctx.out;
  o(`case ${c.id} on ${ctx.chain.contractId}: template ${tplName(c.template)} (sha256 ${short(c.template.bodyHash)}), clerk ${c.clerk.account}`);
  o(`  requester ${c.requester}, submitter ${c.submitter}, phase ${c.phase}${c.ending ? `, ending ${c.ending}` : ''}`);
  o(`  amount ${formatNear(c.amount)}, bond ${formatNear(c.bond)} (floor ${formatNear(c.bondFloor)} = CAP_A at the maximum submission size)`);
  o(`  W ${span(c.wMs)} (each party window W/2 = ${span(c.wMs / 2)}), clerk window W1 ${span(c.clerk.w1Sec * 1000)}`);
  o(`  models: primary ${c.clerk.primaryModel}, panel/comparison ${c.clerk.panelModel}; limits L_crit ${c.clerk.lCrit} B, L_sub ${c.clerk.lSub} B`);
  if (c.phase === 'AwaitingSubmission') o(`  submit by ${iso(c.submitDeadline)} (${now <= c.submitDeadline ? `${span(c.submitDeadline - now)} left` : 'PASSED'})`);
}

// ------------------------------------------------------------- create (§5.1, §5.5, §7.4, §10.1)

// o: { clerk, template: {id, version}, submitter, criteria: Uint8Array, zeroth?: Uint8Array,
//      amount: bigint, bond?: bigint, submitWindowSec, wSec?, dryRun?, allowMissingInputs? }
export async function cmdCreate(ctx, o) {
  const { chain, out } = ctx;
  const contract = chain.contractId;
  if (!o.clerk || !o.submitter || !o.criteria || o.amount === undefined || !o.template || o.submitWindowSec === undefined) {
    throw new CliError('create needs --clerk, --template <id>@<v>, --submitter, --criteria <file>, --amount <NEAR>, --submit-window <dur>');
  }
  const amount = BigInt(o.amount);
  const wSec = o.wSec === undefined ? W_DEFAULT_S : o.wSec;
  if (wSec < W_MIN_S || wSec > W_MAX_S) throw new CliError(`W must be between ${span(W_MIN_S * 1000)} and ${span(W_MAX_S * 1000)} (§10.1)`);
  if (o.submitWindowSec < SUBMIT_MIN_S || o.submitWindowSec > SUBMIT_MAX_S) throw new CliError(`the submit window must be between ${span(SUBMIT_MIN_S * 1000)} and ${span(SUBMIT_MAX_S * 1000)} (§10.1)`);
  if (o.submitter === ctx.account) throw new CliError('the submitter must differ from the requester (§10.1)');
  if (o.submitter === o.clerk) throw new CliError('the submitter must not be the clerk (§10.1)');

  // The clerk's registration and the template, exactly as the case will pin them.
  const reg = await chain.view('get_clerk', { account: o.clerk });
  if (!reg) throw new CliError(`${o.clerk} is not a registered clerk on ${contract}`);
  const tpl = await chain.view('get_template', { clerk: o.clerk, template_id: o.template.id, version: o.template.version });
  if (!tpl) throw new CliError(`template ${o.template.id}@${o.template.version} is not in the registry of clerk ${o.clerk}`);
  if (sha256hex(utf8(tpl.body)) !== tpl.bodyHash) throw new CliError(`template ${tplName(tpl)}: sha256(body) differs from the registry's body hash; refusing to create a case on it`, EXIT.CHECK_FAILED);
  // Template constraints: the kernel's own check (e.g. amount_zero -> price must be 0).
  try { registry.checkTemplateConstraints(tpl, { amount }); } catch (e) { throw new CliError(`create refused: ${e.message} (§5.1, §5.5)`); }

  // Criteria material, with the zeroth-decision record appended under the
  // template's declared case-file heading when given separately.
  let body = o.criteria;
  const caseFileInputs = (tpl.requiredInputs || []).filter((r) => r.side === 'case_file');
  if (o.zeroth) {
    if (!caseFileInputs.length) throw new CliError(`template ${tplName(tpl)} declares no case-file input; put the record inside the criteria instead of --zeroth-decision`);
    const heading = caseFileInputs[0].heading;
    if (hasHeading(textOf(body), heading)) throw new CliError(`the criteria already contain "${heading}"; pass the record either inside the criteria or with --zeroth-decision, not both`);
    body = concat(body, utf8(`\n\n${heading}\n`), o.zeroth);
  }
  if (body.length > reg.lCrit) throw new CliError(`the criteria are ${body.length} bytes, above the clerk's L_crit = ${reg.lCrit} bytes (§10.2)`);
  const missing = caseFileInputs.filter((r) => !hasHeading(textOf(body), r.heading));
  for (const r of missing) {
    const msg = `the case file lacks the required input "${r.heading}" declared by ${tplName(tpl)}: the clerk would post ${r.on_missing} without a model call (§7.5)`;
    if (!o.allowMissingInputs) throw new CliError(`create refused: ${msg}; add the record (or --zeroth-decision <file>), or pass --allow-missing-inputs`);
    out(`WARNING (--allow-missing-inputs): ${msg}`);
  }

  // Keys: R must be able to open env_r later; S must have a key for env_s.
  const { pk } = requireSealKey(ctx, 'to create a case (you open the requester envelope with it)');
  const myKey = await chain.view('get_key', { account: ctx.account });
  if (myKey !== toHex(pk)) throw new CliError(`your registered sealing key ${myKey ? short(myKey) : '(none)'} is not the key in your key file; run register-key first`);
  const subKey = await chain.view('get_key', { account: o.submitter });
  if (!subKey) throw new CliError(`the submitter ${o.submitter} has not registered a sealing key`);

  // Bond (§10.1): floor = CAP_A at the maximum submission size, computed by the kernel.
  const ctLen = bucketCiphertextLen(SALT_LEN + body.length);
  const floor = settlement.bondFloorOf(reg, ctLen, tpl.bodyLen);
  const bounds = settlement.bondBounds(amount, floor);
  const bond = o.bond === undefined || o.bond === null ? bounds.dflt : BigInt(o.bond);
  if (bond < bounds.min || bond > bounds.max) throw new CliError(`bond ${yoctoAndNear(bond)} is outside [${bounds.min}, ${bounds.max}] yocto (floor CAP_A(L_sub) .. cap, §10.1)`);

  const caseId = await chain.view('next_case_id', {});
  const mat = buildCriteria({ contract, caseId, criteria: body, submitterPk: fromHex(subKey) });
  const args = {
    clerk: o.clerk, template_id: tpl.id, template_version: tpl.version, submitter: o.submitter, amount: amount.toString(),
    bond: bond.toString(), criteria_hash: mat.criteria_hash, criteria_ct: mat.criteria_ct, env_s: mat.env_s,
    submit_window_sec: o.submitWindowSec, w_sec: wSec, expected_case_id: caseId,
  };
  const storageBytes = fixing.fixCriteria(args, reg.lCrit).storageBytes;
  const storage = settlement.storageFee(storageBytes);
  const deposit = amount + RECORD_FEE + storage;

  out(`create: ${tplName(tpl)} by clerk ${o.clerk}, submitter ${o.submitter}`);
  out(`  criteria ${body.length} bytes -> ciphertext ${ctLen} bytes; criteria hash ${mat.criteria_hash}`);
  out(`  amount ${yoctoAndNear(amount)}; bond ${yoctoAndNear(bond)} (floor ${yoctoAndNear(floor)} = CAP_A at L_sub = ${reg.lSub} B; cap ${formatNear(bounds.max)})`);
  out(`  W ${span(wSec * 1000)}, submit window ${span(o.submitWindowSec * 1000)}, W1 ${span(reg.w1Sec * 1000)}`);
  out(`  deposit required (exact): ${yoctoAndNear(deposit)} = amount + record fee ${formatNear(RECORD_FEE)} + storage ${formatNear(storage)} (${storageBytes} bytes)`);
  const result = { caseId, deposit, amount, bond, bondFloor: floor, criteriaHash: mat.criteria_hash, storageBytes, dryRun: !!o.dryRun };
  if (o.dryRun) { out('dry run: nothing sent'); return result; }

  // Keep SK and the criteria before sending: losing them after a successful
  // create would leave R unable to verify its own case.
  const store = storeFor(ctx, caseId);
  store.write('criteria', body);
  store.write('criteria.salt', mat.salt);
  store.write('SK', mat.SK, { secret: true });
  await sendCall(ctx, 'create_case', args, deposit);
  const c = await getCase(chain, caseId);
  if (c.requester !== ctx.account || c.criteria.hash !== mat.criteria_hash || c.bond !== bond.toString()) {
    throw new CliError(`post-check failed: case ${caseId} on chain is not the case just created`, EXIT.CHECK_FAILED);
  }
  out(`case ${caseId} created; local material in ${store.dir}`);
  return result;
}

// ------------------------------------------------------------- preflight / submit (§3, §7.4, §7.5, §8.2, §5.5 quote_fee)

// The submitter-side examination shared by preflight and submit. Problems
// are { kind, text }; kind 'missing_input' can be overridden at submit.
async function examineForSubmission(ctx, caseId, submission) {
  const { chain } = ctx;
  const c = await getCase(chain, caseId);
  if (roleOf(c, ctx.account) !== 'S') throw new CliError(`${ctx.account} is not the submitter of case ${caseId} (${c.submitter})`);
  const contract = chain.contractId;
  const cctx = ctxOf(contract, c.id);
  const now = await chain.finalBlockTimeMs();
  const store = storeFor(ctx, c.id);
  const problems = [];
  const notes = [];
  if (c.phase !== 'AwaitingSubmission') problems.push({ kind: 'phase', text: `the case is in phase ${c.phase}, not AwaitingSubmission` });
  else if (now > c.submitDeadline) problems.push({ kind: 'deadline', text: `the submission deadline passed at ${iso(c.submitDeadline)}` });

  // The criteria: decrypt with SK and check against the on-chain hash (§9.1).
  const SK = await submitterSK(ctx, c, store);
  let crit;
  try { crit = splitSalted(dec(SK, LABELS.std, fromB64(await blob(chain, c.id, 'criteria_ct')), cctx)); } catch {
    throw new CliError('the criteria ciphertext does not open under the SK from your envelope: the clerk would FAIL this case at check 2; do not work on it', EXIT.CHECK_FAILED);
  }
  if (commit(crit.salt, crit.body) !== c.criteria.hash) throw new CliError('the decrypted criteria do not reproduce the on-chain criteria hash: do not work on this case', EXIT.CHECK_FAILED);
  store.write('SK', SK, { secret: true });
  store.write('criteria', crit.body);
  store.write('criteria.salt', crit.salt);

  // The template the clerk will run: the registry body must match the pinned hash.
  const tplEntry = await chain.view('get_template', { clerk: c.template.clerk, template_id: c.template.id, version: c.template.version });
  let template = null;
  try { template = verifyPinnedTemplate(c, tplEntry); } catch (e) { problems.push({ kind: 'template', text: e.message }); }

  const critText = textOf(crit.body);
  for (const r of c.template.requiredInputs || []) {
    if (r.side !== 'case_file') continue;
    if (hasHeading(critText, r.heading)) notes.push(`the case file contains the required input "${r.heading}"`);
    else notes.push(`the case file LACKS the required input "${r.heading}": the template maps that to ${r.on_missing} with no model call (§7.5)`);
  }

  let sub = null;
  if (submission) {
    if (submission.length > c.clerk.lSub) problems.push({ kind: 'size', text: `the submission is ${submission.length} bytes, above the case limit L_sub = ${c.clerk.lSub} bytes (§10.2)` });
    const subText = textOf(submission);
    for (const r of c.template.requiredInputs || []) {
      if (r.side !== 'submission') continue;
      if (hasHeading(subText, r.heading)) notes.push(`the submission contains the required input "${r.heading}"`);
      else problems.push({ kind: 'missing_input', text: `the submission lacks the required input "${r.heading}" declared by ${tplName(c.template)}: the clerk would post FAIL with no model call and charge base_1 (§7.5, §6.1)` });
    }
    // Reuse the salt prepared for this exact submission, so the request a
    // preflight writes is byte-identical to the clerk's (§8.2 pre-trial).
    const prepared = store.read('submission');
    const salt = prepared && equalBytes(prepared, submission) && store.read('submission.salt') ? store.read('submission.salt') : newSalt();
    sub = { body: submission, salt, text: subText, ctLen: bucketCiphertextLen(SALT_LEN + submission.length) };
  }
  return { c, now, contract, store, SK, crit, critText, template, problems, notes, sub };
}

function materialArgs(x) {
  const mat = buildSubmission({
    contract: x.contract, caseId: x.c.id, submission: x.sub.body, SK: x.SK,
    clerkPk: fromHex(x.c.clerk.sealKey), requesterPk: fromHex(x.c.requesterKey), salt: x.sub.salt,
  });
  return { mat, args: { case_id: x.c.id, sub_hash: mat.sub_hash, sub_ct: mat.sub_ct, env_c: mat.env_c, env_r: mat.env_r, lock: mat.lock } };
}

// o: { caseId, submission?: Uint8Array, requestOut?: (bytes) => path, showTemplate? }
export async function cmdPreflight(ctx, o) {
  const out = ctx.out;
  const x = await examineForSubmission(ctx, o.caseId, o.submission);
  printTerms(ctx, x.c, x.now);
  out('criteria (decrypted with SK from your envelope; sha256(salt || criteria) matches the on-chain hash):');
  out('-----BEGIN CRITERIA-----');
  out(x.critText);
  out('-----END CRITERIA-----');
  if (x.template) {
    out(`template ${tplName(x.template)}: registry body matches the pinned hash ${x.template.bodyHash}`);
    if (o.showTemplate) { out('-----BEGIN TEMPLATE-----'); out(x.template.body); out('-----END TEMPLATE-----'); }
  }
  const declared = (x.c.template.requiredInputs || []).map((r) => `${r.side}: "${r.heading}"`);
  out(`required inputs declared: ${declared.length ? declared.join('; ') : 'none'}`);
  for (const n of x.notes) out(`  note: ${n}`);

  const result = { caseId: x.c.id, ok: false, problems: x.problems.map((p) => p.text), notes: x.notes, criteria: x.critText, deposit: null };
  if (x.sub) {
    out(`submission: ${x.sub.body.length} bytes -> ciphertext ${x.sub.ctLen} bytes (limit L_sub ${x.c.clerk.lSub} bytes)`);
    if (x.sub.body.length <= x.c.clerk.lSub) {
      const { args } = materialArgs(x);
      const q = await submitQuote(ctx.chain, x.c, args);
      out(`deposit for submit (exact): ${yoctoAndNear(q.deposit)} = CAP_1 ${formatNear(q.cap1)} (quote_fee primary, sub_len ${q.ctLen}) + storage ${formatNear(q.storage)} (${q.storageBytes} bytes)`);
      Object.assign(result, { deposit: q.deposit, cap1: q.cap1, storage: q.storage, ctLen: q.ctLen });
      // Keep the prepared submission and its salt so submit reuses them.
      x.store.write('submission', x.sub.body);
      x.store.write('submission.salt', x.sub.salt);
      if (o.requestOut && x.template) {
        const data = {
          criteria: x.critText, submission: x.sub.text, criteriaHash: x.c.criteria.hash, subHash: commit(x.sub.salt, x.sub.body),
          criteriaSalt: toHex(x.crit.salt), subSalt: toHex(x.sub.salt),
        };
        const req = primaryRequest({ contract: x.contract, c: x.c, template: x.template, data });
        const p = o.requestOut(req);
        const b = settlement.inputBounds(x.c.clerk, x.c.criteria.ctLen, q.ctLen, x.c.template.bodyLen);
        out(`pre-trial request (exact bytes the clerk will send if you submit this file): ${p}, ${req.length} bytes, sha256 ${sha256hex(req)}`);
        out(`  model ${x.c.clerk.primaryModel}, max_tokens ${x.c.clerk.stages.primary.maxTokens}; input bound IN_1 = ${b.in1} tokens (tokens <= bytes)`);
        result.requestHash = sha256hex(req);
      }
    }
  } else {
    out('no --submission given: criteria shown, submission checks and deposit skipped');
  }
  result.ok = x.problems.length === 0 && !!x.sub;
  if (x.problems.length) {
    out('PROBLEMS:');
    for (const p of x.problems) out(`  - ${p.text}`);
  }
  out(result.ok ? 'preflight OK: ready to submit' : x.sub ? 'preflight NOT OK: fix the problems above before submitting' : 'preflight incomplete (no submission)');
  return result;
}

// o: { caseId, submission: Uint8Array, expectDeposit?: bigint, dryRun?, allowMissingInputs? }
export async function cmdSubmit(ctx, o) {
  const out = ctx.out;
  if (!o.submission) throw new CliError('submit needs --submission <file>');
  const x = await examineForSubmission(ctx, o.caseId, o.submission);
  const blocking = x.problems.filter((p) => !(p.kind === 'missing_input' && o.allowMissingInputs));
  if (blocking.length) throw new CliError(`submit refused, nothing sent:\n  - ${blocking.map((p) => p.text).join('\n  - ')}`);
  for (const p of x.problems) if (p.kind === 'missing_input') out(`WARNING (--allow-missing-inputs): ${p.text}`);

  const { mat, args } = materialArgs(x);
  const q = await submitQuote(ctx.chain, x.c, args);
  out(`submit case ${x.c.id}: ciphertext ${q.ctLen} bytes, submission hash ${mat.sub_hash}, lock ${mat.lock}`);
  out(`  deposit (exact): ${yoctoAndNear(q.deposit)} = CAP_1 ${q.cap1} (quote_fee primary, sub_len ${q.ctLen}) + storage ${q.storage} (${q.storageBytes} bytes); the price was escrowed at create`);
  if (o.expectDeposit !== undefined && o.expectDeposit !== null && BigInt(o.expectDeposit) !== q.deposit) {
    throw new CliError(`deposit mismatch, nothing sent: you expected ${BigInt(o.expectDeposit)} yocto, the contract requires exactly ${q.deposit} yocto (deposits are exact, §2.2)`);
  }
  const result = { caseId: x.c.id, deposit: q.deposit, cap1: q.cap1, storage: q.storage, ctLen: q.ctLen, subHash: mat.sub_hash, lock: mat.lock, dryRun: !!o.dryRun };
  if (o.dryRun) { out('dry run: nothing sent'); return result; }

  x.store.write('submission', x.sub.body);
  x.store.write('submission.salt', x.sub.salt);
  x.store.write('K', mat.K, { secret: true });
  x.store.write('K2', mat.K2, { secret: true });
  await sendCall(ctx, 'submit', args, q.deposit);
  const c = await getCase(ctx.chain, x.c.id);
  if (c.phase !== 'AwaitingDecision' || c.submission.hash !== mat.sub_hash || c.fee1.deposit !== q.cap1.toString()) {
    throw new CliError('post-check failed: the case on chain does not show this submission with CAP_1 = the quoted fee', EXIT.CHECK_FAILED);
  }
  out(`submitted; decision due by ${iso(deadlines.decisionDeadline(c))}; K and K2 kept in ${x.store.dir}`);
  return result;
}

// ------------------------------------------------------------- appeal / respond (§5.1, §6, §8.3)

// o: { caseId, expectDeposit?, dryRun? }
export async function cmdAppeal(ctx, o) {
  const { chain, out } = ctx;
  const c = await getCase(chain, o.caseId);
  if (c.phase !== 'Decided') throw new CliError(`cannot appeal case ${c.id} in phase ${c.phase} (only a Decided case, once)`);
  const appellant = c.decision.verdict === 'PASS' ? c.requester : c.submitter;
  if (ctx.account !== appellant) throw new CliError(`only the side the primary ${c.decision.verdict} went against may appeal: ${appellant}`);
  const now = await chain.finalBlockTimeMs();
  const deadline = deadlines.appealDeadline(c);
  if (now > deadline) throw new CliError(`the appeal window closed at ${iso(deadline)}; nothing sent`);
  const capA = BigInt(await chain.view('quote_fee', { case_id: c.id, kind: 'appeal', sub_len: c.submission.ctLen }));
  const deposit = BigInt(c.bond) + capA;
  out(`appeal case ${c.id} against the primary ${c.decision.verdict} (window closes ${iso(deadline)}, ${span(deadline - now)} left)`);
  out(`  deposit (exact): ${yoctoAndNear(deposit)} = bond ${c.bond} + CAP_A ${capA} (quote_fee appeal, sub_len ${c.submission.ctLen})`);
  out('  note: the appeal record (panel and comparison reasons) is readable by both parties (§11.2)');
  if (o.expectDeposit !== undefined && o.expectDeposit !== null && BigInt(o.expectDeposit) !== deposit) throw new CliError(`deposit mismatch, nothing sent: expected ${BigInt(o.expectDeposit)}, required exactly ${deposit}`);
  const result = { caseId: c.id, deposit, capA, bond: BigInt(c.bond), dryRun: !!o.dryRun };
  if (o.dryRun) { out('dry run: nothing sent'); return result; }
  await sendCall(ctx, 'appeal', { case_id: c.id }, deposit);
  const c2 = await getCase(chain, c.id);
  if (c2.phase !== 'Appealed' || c2.appeal.fee.deposit !== capA.toString()) throw new CliError('post-check failed: the case does not show this appeal', EXIT.CHECK_FAILED);
  out(`appealed; ${c2.appeal.respondent} may respond with the bond until ${iso(deadlines.respondDeadline(c2))}`);
  return result;
}

// The spec's respond (§5.1 "控訴中 -> respond -> 審理中", §5.5, §6): the
// favored side posts the same bond so the review can run.
export async function cmdRespond(ctx, o) {
  const { chain, out } = ctx;
  const c = await getCase(chain, o.caseId);
  if (c.phase !== 'Appealed') throw new CliError(`cannot respond to case ${c.id} in phase ${c.phase} (only an Appealed case)`);
  if (ctx.account !== c.appeal.respondent) throw new CliError(`only the favored side may respond: ${c.appeal.respondent}`);
  const now = await chain.finalBlockTimeMs();
  const deadline = deadlines.respondDeadline(c);
  if (now > deadline) throw new CliError(`the response window closed at ${iso(deadline)} (the appellant wins by default); nothing sent`);
  const deposit = BigInt(c.bond);
  out(`respond to the appeal on case ${c.id}: deposit (exact) bond ${yoctoAndNear(deposit)}; window closes ${iso(deadline)}`);
  const result = { caseId: c.id, deposit, dryRun: !!o.dryRun };
  if (o.dryRun) { out('dry run: nothing sent'); return result; }
  await sendCall(ctx, 'respond', { case_id: c.id }, deposit);
  const c2 = await getCase(chain, c.id);
  if (c2.phase !== 'UnderReview') throw new CliError('post-check failed: the case is not UnderReview', EXIT.CHECK_FAILED);
  out(`responded; review by ${c.clerk.account} due by ${iso(deadlines.reviewDeadline(c2))}`);
  return result;
}

// ------------------------------------------------------------- clerk-step (stage-2 pipeline, one case)

export async function cmdClerkStep(ctx, o) {
  if (!ctx.makeClerk) throw new CliError('clerk-step is not available in this configuration');
  const clerk = await ctx.makeClerk();
  const ev = await clerk.step(o.caseId);
  ctx.out(`clerk-step case ${o.caseId}: ${ev.action}${ev.verdict ? ` ${ev.verdict}` : ''}${ev.result ? ` ${ev.result} (${ev.path})` : ''}${ev.why ? ` - ${ev.why}` : ''}`);
  if (ev.action === 'error') throw new CliError(`clerk-step failed: ${ev.why}`, EXIT.CHECK_FAILED);
  return ev;
}

// ------------------------------------------------------------- finalize (§5.3, §5.4, §7.6)

async function k2Available(ctx, c) {
  const store = storeFor(ctx, c.id);
  const local = store.read('K2');
  if (local && lockOf(local) === c.submission.lock) return { K2: local, source: 'your local K2 (written by submit)' };
  if (ctx.sealKey && ctx.account === c.clerk.account) {
    const env = openClerkEnvelope({ contract: ctx.chain.contractId, caseId: c.id, clerkSk: ctx.sealKey.sk, envC: await blob(ctx.chain, c.id, 'env_c') });
    if (env && lockOf(env.K2) === c.submission.lock) return { K2: env.K2, source: 'the clerk envelope' };
  }
  return null;
}

// o: { caseId, force? }
// The k2 client rule is clerk/k2.mjs: releaseCheck (condition a, on the case
// read at finality "final") and decideK2Send (condition b with the margin and
// the explicit force flag). This command only routes on their answers.
export async function cmdFinalize(ctx, o) {
  const { chain, out } = ctx;
  const marginMs = ctx.marginMs ?? RELEASE_MARGIN_MS;
  const c = await getCase(chain, o.caseId);
  if (c.phase === 'Closed') { out(`case ${c.id} is already closed: ${c.ending}`); return { caseId: c.id, ending: c.ending, sent: false, k2Sent: false }; }
  const now = await chain.finalBlockTimeMs();
  const t = closingTransition(c, now);
  if (!t) throw new CliError(`nothing to finalize yet on case ${c.id} (phase ${c.phase}); no transaction sent (a k2 sent before finality would leak, §7.6)`);

  const rc = releaseCheck(c, now);
  let k2Sent = false;
  let decision = null;
  if (rc.eligible) {
    // A final PASS with amount > 0: the only finalize that pays S, so the only one that carries k2.
    decision = decideK2Send({ now, deadline: rc.deadline, marginMs, force: !!o.force });
    if (decision.action === 'refuse') {
      throw new CliError(`k2 NOT sent: ${decision.reason}. Release window ends ${iso(rc.deadline)}. Without a release the case ends PASS_UNRELEASED: the price returns to R and the submission stays unread and reusable.`, EXIT.K2_REFUSED);
    }
    if (decision.action === 'send') {
      const k = await k2Available(ctx, c);
      if (!k) throw new CliError('k2 should be released now, but this account holds no K2 matching the lock (the submitter keeps it from submit; the clerk opens its envelope); nothing sent');
      out(`releasing k2 from ${k.source}: ${decision.reason}${decision.forced ? ' [--force]' : ''}`);
      await sendCall(ctx, 'finalize', { case_id: c.id, k2: toHex(k.K2) }, 0n);
      k2Sent = true;
    } else {
      // 'expired': past final + W/2. Never send k2, force or not; only the k2-less finalize is valid.
      out(`no k2: ${decision.reason}`);
      await sendCall(ctx, 'finalize', { case_id: c.id }, 0n);
    }
  } else {
    if (o.force) out(`note: --force has no effect here: ${rc.why || 'this finalize pays the submitter nothing'}; k2 is never sent`);
    out(`finalize without k2 (${t.ending}${t.outcome ? `, outcome ${t.outcome}` : ''}): this transition pays the submitter no price (§5.4)`);
    await sendCall(ctx, 'finalize', { case_id: c.id }, 0n);
  }
  const c2 = await getCase(chain, c.id);
  out(`case ${c.id} closed: ${c2.ending}${c2.k2 ? ' (k2 on chain)' : ''}`);
  return { caseId: c.id, ending: c2.ending, sent: true, k2Sent, decision };
}

// ------------------------------------------------------------- open (§3.1 step 6, §7.2, §7.6)

// o: { caseId, writeOut?: (bytes) => path }
export async function cmdOpen(ctx, o) {
  const { chain, out } = ctx;
  const c = await getCase(chain, o.caseId);
  if (roleOf(c, ctx.account) !== 'R') throw new CliError(`open is for the requester of case ${c.id} (${c.requester})`);
  if (!c.k2) throw new CliError(`no k2 on chain for case ${c.id} (${c.ending || c.phase}): the submission was not released and cannot be opened`);
  const cctx = ctxOf(chain.contractId, c.id);
  const k2 = fromHex(c.k2);
  if (lockOf(k2) !== c.submission.lock) throw new CliError('sha256(k2) on chain does not match the lock', EXIT.CHECK_FAILED);
  const { sk } = requireSealKey(ctx, 'to open your envelope (env_r)');
  let K1;
  try { K1 = open(sk, fromB64(await blob(chain, c.id, 'env_r')), LABELS.wR, cctx); } catch {
    throw new CliError('your envelope (env_r) does not open with your sealing key', EXIT.CHECK_FAILED);
  }
  let sub;
  try { sub = splitSalted(dec(xor(K1, k2), LABELS.sub, fromB64(await blob(chain, c.id, 'sub_ct')), cctx)); } catch {
    throw new CliError('the submission ciphertext does not open under K = K1 xor k2; nothing printed or saved', EXIT.CHECK_FAILED);
  }
  if (commit(sub.salt, sub.body) !== c.submission.hash) {
    throw new CliError('the decrypted submission does NOT match the on-chain submission commitment; nothing printed or saved', EXIT.CHECK_FAILED);
  }
  const store = storeFor(ctx, c.id);
  store.write('submission', sub.body);
  store.write('submission.salt', sub.salt);
  const path = o.writeOut ? o.writeOut(sub.body) : store.path('submission');
  out(`case ${c.id}: submission opened with K1 xor k2; sha256(salt || submission) matches the on-chain commitment ${c.submission.hash}`);
  out(`saved ${sub.body.length} bytes to ${path}`);
  if (o.print !== false) { out('-----BEGIN SUBMISSION-----'); out(textOf(sub.body)); out('-----END SUBMISSION-----'); }
  return { caseId: c.id, bytes: sub.body.length, path, submission: sub.body };
}

// ------------------------------------------------------------- verify (§9.1, §9.2)

// The party's material for the checks: local files first, then what the
// chain and the party's own keys open.
async function partyMaterial(ctx, c, role, store, cctx) {
  const { chain } = ctx;
  const m = {};
  m.SK = store.read('SK');
  if (!m.SK && role === 'S' && ctx.sealKey) {
    try { m.SK = open(ctx.sealKey.sk, fromB64(await blob(chain, c.id, 'env_s')), LABELS.wSkS, cctx); } catch { m.SK = null; }
  }
  if (m.SK) { try { m.critChain = splitSalted(dec(m.SK, LABELS.std, fromB64(await blob(chain, c.id, 'criteria_ct')), cctx)); } catch { m.critChain = null; } }
  const cb = store.read('criteria');
  const cs = store.read('criteria.salt');
  if (cb && cs) m.critLocal = { body: cb, salt: cs };
  if (c.submission) {
    if (role === 'S') {
      const sb = store.read('submission');
      const ss = store.read('submission.salt');
      if (sb && ss) m.subLocal = { body: sb, salt: ss };
      const K = store.read('K');
      const K2 = store.read('K2');
      if (K && K2) { m.K = K; m.K2 = K2; m.K1 = xor(K, K2); }
    } else if (ctx.sealKey) {
      try { m.K1 = open(ctx.sealKey.sk, fromB64(await blob(chain, c.id, 'env_r')), LABELS.wR, cctx); } catch { m.K1 = null; }
    }
    const subKey = m.K || (c.k2 && m.K1 ? xor(m.K1, fromHex(c.k2)) : null);
    if (subKey) { try { m.subChain = splitSalted(dec(subKey, LABELS.sub, fromB64(await blob(chain, c.id, 'sub_ct')), cctx)); } catch { m.subChain = null; } }
  }
  return m;
}

function openRecord(keys, label, blobB64, cctx) {
  for (const [key, name] of keys) {
    if (!key) continue;
    try { return { rec: decodeRecord(dec(key, label, fromB64(blobB64), cctx)), keyName: name }; } catch { /* next key */ }
  }
  return null;
}

async function sigOk(ctx, model, req, resp, sig) {
  try { return !!(await ctx.verifySignature({ text: signatureText(model, req, resp), signature: sig.sig, algo: sig.algo, address: sig.addr })); } catch { return false; }
}

// o: { caseId, templateBody?: Uint8Array }
export async function cmdVerify(ctx, o) {
  const { chain, out } = ctx;
  const c = await getCase(chain, o.caseId);
  const role = roleOf(c, ctx.account);
  if (role !== 'R' && role !== 'S') throw new CliError(`${ctx.account} is neither the requester nor the submitter of case ${c.id}; the §9.1 checks need a party's material`);
  const contract = chain.contractId;
  const cctx = ctxOf(contract, c.id);
  const store = storeFor(ctx, c.id);
  const signers = await chain.view('get_signers', {});
  const checks = [];
  const add = (status) => (name, detail) => checks.push({ name, status, detail });
  const pass = add('pass'), fail = add('fail'), skip = add('skip');

  // --- template (§8.2 registration and pinning, §9.1 row 1)
  const tplEntry = await chain.view('get_template', { clerk: c.template.clerk, template_id: c.template.id, version: c.template.version });
  let template = null;
  try {
    template = verifyPinnedTemplate(c, tplEntry);
    if (utf8(tplEntry.body).length !== c.template.bodyLen) throw new Error(`registry body is ${utf8(tplEntry.body).length} bytes, the case pinned ${c.template.bodyLen}`);
    pass('template', `${tplName(c.template)} of ${c.template.clerk}: sha256(registry body) = pinned hash ${short(c.template.bodyHash)}`);
  } catch (e) {
    template = null;
    fail('template', `${tplName(c.template)}: ${e.message}`);
  }
  // The body the requests are rebuilt with: the registry body, labelled with
  // the pinned hash, so a body that differs from the pin also fails the
  // request checks below.
  const rebuildTpl = tplEntry ? { id: c.template.id, version: c.template.version, bodyHash: c.template.bodyHash, body: tplEntry.body } : null;
  if (o.templateBody) {
    const h = sha256hex(o.templateBody);
    if (h === c.template.bodyHash) pass('template.local', `your local template copy hashes to the pinned ${short(h)}`);
    else fail('template.local', `your local template copy hashes to ${short(h)}, not the pinned ${short(c.template.bodyHash)}`);
  }

  // --- criteria (§9.1 row 2)
  const m = await partyMaterial(ctx, c, role, store, cctx);
  const crit = m.critLocal || m.critChain || null;
  const critOk = !!crit && commit(crit.salt, crit.body) === c.criteria.hash;
  if (!crit) skip('criteria.commitment', role === 'R' ? 'no local criteria and salt for this case (create writes them)' : 'cannot open the criteria envelope with your sealing key');
  else if (critOk) pass('criteria.commitment', `sha256(salt || criteria) = on-chain criteria hash (${m.critLocal ? 'local copy' : 'decrypted with SK'})`);
  else fail('criteria.commitment', 'sha256(salt || criteria) differs from the on-chain criteria hash');
  if (!m.SK) skip('criteria.ciphertext', 'no SK available');
  else if (!m.critChain) fail('criteria.ciphertext', 'the on-chain criteria ciphertext does not open under SK');
  else if (commit(m.critChain.salt, m.critChain.body) !== c.criteria.hash) fail('criteria.ciphertext', 'the on-chain criteria ciphertext opens to text that does not match the criteria hash');
  else if (m.critLocal && !equalBytes(m.critLocal.body, m.critChain.body)) fail('criteria.ciphertext', 'the on-chain criteria ciphertext differs from your local criteria');
  else pass('criteria.ciphertext', 'the on-chain criteria ciphertext opens under SK to the committed criteria');

  // --- submission (§9.1 row 3), lock and requester envelope (§7.5 check 4)
  let sub = null;
  if (!c.submission) skip('submission', `no submission (phase ${c.phase})`);
  else if (role === 'S') {
    sub = m.subLocal && commit(m.subLocal.salt, m.subLocal.body) === c.submission.hash ? m.subLocal : null;
    if (!m.subLocal) skip('submission.commitment', 'no local submission and salt (submit writes them)');
    else if (sub) pass('submission.commitment', 'sha256(salt || submission) = on-chain submission hash');
    else fail('submission.commitment', 'your local submission does not match the on-chain submission hash');
    if (!m.K) skip('submission.ciphertext', 'no local K and K2 (submit writes them)');
    else if (!m.subChain) fail('submission.ciphertext', 'the on-chain submission ciphertext does not open under your K');
    else if (commit(m.subChain.salt, m.subChain.body) !== c.submission.hash) fail('submission.ciphertext', 'the on-chain submission ciphertext opens to text that does not match the hash');
    else pass('submission.ciphertext', 'the on-chain submission ciphertext opens under K to the committed submission');
    if (m.K) {
      const envR = seal(fromHex(c.requesterKey), xor(m.K, m.K2), LABELS.wR, eROf(m.K, m.K2, cctx), cctx);
      if (lockOf(m.K2) !== c.submission.lock) fail('submission.release', 'sha256(K2) does not match the on-chain lock');
      else if (!equalBytes(envR, fromB64(await blob(chain, c.id, 'env_r')))) fail('submission.release', 'the requester envelope does not recompute byte for byte from K, K2 and the pinned requester key');
      else pass('submission.release', 'sha256(K2) = lock and the requester envelope recomputes byte for byte: k2 opens the submission for R (§7.5 check 4)');
    }
  } else {
    if (!c.k2) skip('submission.commitment', 'only after release: no k2 on chain (§9.1)');
    else if (!m.K1) fail('submission.commitment', 'your envelope (env_r) does not open with your sealing key');
    else if (!m.subChain) fail('submission.commitment', 'the on-chain submission ciphertext does not open under K1 xor k2');
    else if (commit(m.subChain.salt, m.subChain.body) !== c.submission.hash) fail('submission.commitment', 'the released submission does not match the on-chain submission hash');
    else { sub = m.subChain; pass('submission.commitment', 'the released submission (K1 xor k2) matches the on-chain submission hash'); }
  }
  if (c.k2) {
    if (lockOf(fromHex(c.k2)) === c.submission.lock) pass('k2', 'sha256(k2 on chain) = lock');
    else fail('k2', 'sha256(k2 on chain) differs from the lock');
  }
  const data = critOk && sub ? {
    criteria: textOf(crit.body), submission: textOf(sub.body), criteriaHash: c.criteria.hash, subHash: c.submission.hash,
    criteriaSalt: toHex(crit.salt), subSalt: toHex(sub.salt),
  } : null;
  const noRequest = role === 'R' ? 'needs the submission: R can rebuild the request only after release (§9.1)' : 'needs your local criteria and submission material';

  // --- primary decision (§8.2, §9.1 rows 5, 6, 7, 8, §6.1)
  let primaryReason = null;
  if (!c.decision) skip('decision', `no decision posted (phase ${c.phase})`);
  else {
    const declared = c.decision.usage || [];
    const opened = openRecord([[m.K1, 'K1'], [CHECK1_RESPONSE_KEY, 'the public check-1 key']], LABELS.resp0, await blob(chain, c.id, 'response'), cctx);
    if (!opened) fail('decision.record', m.K1 ? 'the posted response does not decrypt under K1 to a sealgate7 record' : 'no K1: your envelope does not open, so the response cannot be read');
    else {
      const h = opened.rec.header;
      pass('decision.record', `the posted response decrypts under ${opened.keyName} to a "${h.k}" record`);
      if (h.k === 'formal') {
        primaryReason = h.reason || null;
        if (h.verdict === c.decision.verdict) pass('decision.verdict', `formal result ${h.verdict} (no model call) = posted verdict`);
        else fail('decision.verdict', `posted ${c.decision.verdict} differs from the recorded formal result ${h.verdict}`);
        if (declared.length === 0) pass('decision.usage', 'a formal result declares no usage (charge = base_1)');
        else fail('decision.usage', `a formal result was posted with usage ${JSON.stringify(declared)}`);
        const material = h.side === 'case_file' ? crit && critOk && textOf(crit.body) : h.side === 'submission' ? sub && textOf(sub.body) : null;
        if (h.side && typeof material === 'string') {
          if (hasHeading(material, h.heading)) fail('decision.formal', `the ${h.side} does contain "${h.heading}", yet a missing-input result was posted`);
          else pass('decision.formal', `the ${h.side} indeed lacks "${h.heading}"`);
        } else skip('decision.formal', h.check ? `formal defect at check ${h.check}: fully re-run only with the clerk key (the appeal integrity check re-runs it)` : 'material not available to re-check');
      } else if (h.k === 'primary') {
        let respBytes = null;
        try { respBytes = inflate(payloadSlice(opened.rec.payload, h.z)); } catch { respBytes = null; }
        if (!respBytes) fail('decision.response', 'the signed response bytes cannot be read from the record');
        else {
          const model = c.clerk.primaryModel;
          const respHash = sha256hex(respBytes);
          const sig = h.sig || {};
          const sf = signedCallFailures({ model, reqHash: h.req, respHash, sig, signers });
          if (sf.length) fail('decision.signer', sf.join('; '));
          else pass('decision.signer', `provider_tee signer ${sig.algo}:${short(sig.addr)} is registered on the contract`);
          if (await sigOk(ctx, model, h.req, respHash, sig)) pass('decision.signature', `the TEE signature over "${model}:<request hash>:<response hash>" verifies`);
          else fail('decision.signature', `the TEE signature over "${model}:<request hash>:<response hash>" does not verify`);
          const p = parseVerdictResponse(respBytes);
          if (!p.ok) fail('decision.verdict', `the signed response is not a valid verdict: ${p.why}`);
          else if (p.verdict !== c.decision.verdict) fail('decision.verdict', `posted ${c.decision.verdict} differs from the signed verdict ${p.verdict}`);
          else { primaryReason = p.reason; pass('decision.verdict', `posted ${c.decision.verdict} = the signed verdict`); }
          if (!data || !rebuildTpl) skip('decision.request', data ? 'no registry template to rebuild with' : noRequest);
          else if (sha256hex(primaryRequest({ contract, c, template: rebuildTpl, data })) === h.req) pass('decision.request', 'the request rebuilt from skeleton v7 + pinned template + pinned model + binding + material = the signed request hash');
          else fail('decision.request', 'the rebuilt request does not hash to the signed request hash (template, model, binding or material differ)');
          const u = signedUsage(respBytes);
          if (!u) fail('decision.usage', 'the signed response carries no usage');
          else {
            if (declared.length === 1 && sameUsage(declared[0], declareUsage(u))) pass('decision.usage', `declared ${JSON.stringify(declared[0])} = signed {in ${u.in}, out ${u.out}} rounded up to 1,024-token units`);
            else fail('decision.usage', `declared ${JSON.stringify(declared)} differs from the signed {in ${u.in}, out ${u.out}} rounded up (${JSON.stringify(declareUsage(u))})`);
            const b = settlement.inputBounds(c.clerk, c.criteria.ctLen, c.submission.ctLen, c.template.bodyLen);
            const M = c.clerk.stages.primary.maxTokens;
            if (u.in <= b.in1 && u.out <= M) pass('decision.usage_bound', `signed in ${u.in} <= IN_1 ${b.in1}, out ${u.out} <= M_1 ${M}`);
            else fail('decision.usage_bound', `signed usage {in ${u.in}, out ${u.out}} exceeds IN_1 ${b.in1} / M_1 ${M}`);
          }
        }
      } else fail('decision.record', `unknown record kind ${JSON.stringify(h.k)}`);
    }
    // Settlement recomputed from the declared usage (§6.1, §9.1 billing steps 1-2).
    const lens = lensOf(c);
    const cap = settlement.capPrimaryOf(c.clerk, lens.crit, lens.sub, lens.tpl);
    let charge = null;
    try { charge = settlement.chargePrimaryOf(c.clerk, cap, lens, declared); } catch { charge = null; }
    if (charge !== null && c.fee1.deposit === cap.toString() && c.fee1.charge === charge.toString() && c.fee1.refund === (cap - charge).toString()) {
      pass('decision.charge', `CAP_1 ${cap} = deposit; charge ${charge} recomputed from the declared usage = settled; refund ${cap - charge}`);
    } else fail('decision.charge', `recomputed CAP_1 ${cap}, charge ${charge}; settled deposit ${c.fee1.deposit}, charge ${c.fee1.charge}, refund ${c.fee1.refund}`);
  }

  // --- appeal record (§8.4, §9.1)
  if (c.appeal && c.appeal.decision) {
    const opened = openRecord([[m.K1, 'K1'], [CHECK1_RESPONSE_KEY, 'the public check-1 key']], LABELS.resp1, await blob(chain, c.id, 'record'), cctx);
    if (!opened || opened.rec.header.k !== 'appeal') fail('appeal.record', 'the posted appeal record does not decrypt to a sealgate7 appeal record');
    else {
      const h = opened.rec.header;
      pass('appeal.record', `the posted appeal record decrypts under ${opened.keyName} (path ${h.path})`);
      if (h.result === c.appeal.decision.result && h.primary === c.decision.verdict) pass('appeal.result', `recorded result ${h.result} = posted result; recorded primary ${h.primary} = posted primary`);
      else fail('appeal.result', `recorded result ${h.result} / primary ${h.primary}; posted ${c.appeal.decision.result} / ${c.decision.verdict}`);
      const panel = Array.isArray(h.panel) ? h.panel : [];
      const entries = [...panel.map((e, i) => ({ e, name: `panel[${i}]`, field: 'verdict', parse: parseVerdictResponse })), ...(h.comparison ? [{ e: h.comparison, name: 'comparison', field: 'decision', parse: parseComparisonResponse }] : [])];
      const model = c.clerk.panelModel;
      const sigFailures = [];
      const outFailures = [];
      let withBytes = 0;
      for (const { e, name, field, parse } of entries) {
        const sf = signedCallFailures({ model, reqHash: e.req, respHash: e.resp, sig: e.sig || {}, signers });
        if (sf.length) sigFailures.push(`${name}: ${sf.join('; ')}`);
        else if (!(await sigOk(ctx, model, e.req, e.resp, e.sig || {}))) sigFailures.push(`${name}: signature does not verify`);
        if (!e.z) continue;
        withBytes++;
        let bytes = null;
        try { bytes = inflate(payloadSlice(opened.rec.payload, e.z)); } catch { bytes = null; }
        if (!bytes) { outFailures.push(`${name}: signed bytes unreadable`); continue; }
        if (sha256hex(bytes) !== e.resp) { outFailures.push(`${name}: bytes do not hash to the signed response hash`); continue; }
        const p = parse(bytes);
        if (!p.ok || p[field] !== e[field] || p.reason !== e.reason) outFailures.push(`${name}: recorded ${field}/reason differ from the signed output`);
        const u = signedUsage(bytes);
        if (!u || !e.usage || u.in !== e.usage.in || u.out !== e.usage.out) outFailures.push(`${name}: recorded usage differs from the signed usage`);
      }
      if (!entries.length) skip('appeal.signatures', 'no model calls in the record');
      else if (sigFailures.length) fail('appeal.signatures', sigFailures.join(' | '));
      else pass('appeal.signatures', `${entries.length} call(s): provider_tee, registered signer, signature over "${model}:<req>:<resp>" verifies`);
      if (!entries.length) skip('appeal.outputs', 'no model calls in the record');
      else if (outFailures.length) fail('appeal.outputs', outFailures.join(' | '));
      else pass('appeal.outputs', `${withBytes} of ${entries.length} call(s) carry signed bytes; each matches its hash, recorded output and usage${withBytes < entries.length ? ' (the rest did not fit 8 KB: hashes and signatures only)' : ''}`);

      // Requests: the panel request equals the primary's with the panel model;
      // the comparison request is rebuilt from the record's own contents.
      if (!entries.length) skip('appeal.requests', 'no model calls in the record');
      else if (!data || !rebuildTpl) skip('appeal.requests', noRequest);
      else {
        const bad = [];
        const reqP = sha256hex(buildJudgmentRequest({ contract, caseId: c.id, model, maxTokens: c.clerk.stages.panel.maxTokens, template: rebuildTpl, data }));
        panel.forEach((e, i) => { if (e.req !== reqP) bad.push(`panel[${i}]`); });
        if (h.comparison) {
          const reqC = sha256hex(buildComparisonRequest({
            contract, caseId: c.id, model, maxTokens: c.clerk.stages.comparison.maxTokens, template: rebuildTpl, data,
            primary: { verdict: c.decision.verdict, reason: primaryReason },
            panel: { verdict: h.panelVerdict, members: panel.map((p) => ({ verdict: p.verdict, reason: p.reason })) },
          }));
          if (h.comparison.req !== reqC) bad.push('comparison');
        }
        if (bad.length) fail('appeal.requests', `rebuilt request hash differs for ${bad.join(', ')}`);
        else pass('appeal.requests', 'every panel and comparison request rebuilds to its signed request hash (panel never contains the primary result)');
      }

      // Resolution: majority and the §8.4 rule recomputed from the recorded stages.
      const panelComplete = panel.length === 3;
      const pv = panelComplete ? panelMajority(panel.map((p) => p.verdict)) : null;
      if (h.path === 'formal_rerun') skip('appeal.resolution', 'formal re-run path: decided by the formal inspection, needs the clerk key to recompute');
      else {
        const r = resolveAppeal({
          primaryVerdict: c.decision.verdict, formalConfirmed: !!(h.integrity && h.integrity.formalConfirmed), integrityOk: !!(h.integrity && h.integrity.ok),
          panelComplete, panelVerdict: pv, comparisonDecision: h.comparison ? h.comparison.decision : null,
        });
        if (pv === (h.panelVerdict ?? null) && r.result === h.result && r.path === h.path) pass('appeal.resolution', `panel majority ${pv ?? '(incomplete)'}; ${h.path} -> ${h.result} follows from the recorded stages (§8.4)`);
        else fail('appeal.resolution', `recomputed majority ${pv}, ${r.path} -> ${r.result}; recorded ${h.panelVerdict}, ${h.path} -> ${h.result}`);
      }

      // Usage and settlement.
      const declared = c.appeal.decision.usage || { panel: [], comparison: [] };
      const expected = { panel: panel.map((e) => e.usage && declareUsage(e.usage)), comparison: h.comparison ? [h.comparison.usage && declareUsage(h.comparison.usage)] : [] };
      const sameList = (a, b) => a.length === b.length && a.every((x, i) => sameUsage(x, b[i]));
      if (sameList(declared.panel || [], expected.panel) && sameList(declared.comparison || [], expected.comparison)) pass('appeal.usage', `declared usage = the recorded signed usage rounded up (panel ${expected.panel.length}, comparison ${expected.comparison.length})`);
      else fail('appeal.usage', `declared ${JSON.stringify(declared)} differs from the recorded usage rounded up ${JSON.stringify(expected)}`);
      const lens = lensOf(c);
      const capA = settlement.capAppealOf(c.clerk, lens.crit, lens.sub, lens.tpl);
      let chargeA = null;
      try { chargeA = settlement.chargeAppealOf(c.clerk, capA, lens, { panel: declared.panel || [], comparison: declared.comparison || [] }); } catch { chargeA = null; }
      const f = c.appeal.fee;
      if (chargeA !== null && f.deposit === capA.toString() && f.charge === chargeA.toString() && f.refund === (capA - chargeA).toString()) pass('appeal.charge', `CAP_A ${capA} = deposit; charge ${chargeA} recomputed from the declared usage = settled; refund ${capA - chargeA}`);
      else fail('appeal.charge', `recomputed CAP_A ${capA}, charge ${chargeA}; settled ${f.deposit} / ${f.charge} / ${f.refund}`);
    }
  } else if (c.appeal) skip('appeal', `appeal by ${c.appeal.by}, no appeal decision posted (phase ${c.phase})`);

  const failed = checks.filter((x) => x.status === 'fail').length;
  out(`verify case ${c.id} as ${role === 'R' ? 'requester' : 'submitter'} ${ctx.account} (phase ${c.phase}${c.ending ? `, ${c.ending}` : ''}):`);
  for (const x of checks) out(`  ${x.status.toUpperCase().padEnd(4)}  ${x.name.padEnd(22)} ${x.detail}`);
  out(failed ? `${failed} check(s) FAILED` : 'all checks passed (skipped checks are not failures)');
  return { caseId: c.id, role, ok: failed === 0, checks };
}

// ------------------------------------------------------------- small commands

export async function cmdShow(ctx, o) {
  const { chain, out } = ctx;
  const c = await getCase(chain, o.caseId);
  const now = await chain.finalBlockTimeMs();
  printTerms(ctx, c, now);
  if (c.submission) out(`  submission ${c.submission.ctLen} B ciphertext, hash ${short(c.submission.hash)}, CAP_1 ${c.fee1.deposit}${c.fee1.charge !== null ? `, charged ${c.fee1.charge}` : ''}`);
  if (c.phase === 'AwaitingDecision') out(`  decision due by ${iso(deadlines.decisionDeadline(c))}`);
  if (c.decision) out(`  decision ${c.decision.verdict} at ${iso(c.decision.at)}, usage ${JSON.stringify(c.decision.usage)}`);
  if (c.phase === 'Decided') out(`  appeal window until ${iso(deadlines.appealDeadline(c))}`);
  if (c.appeal) out(`  appeal by ${c.appeal.by}; respondent ${c.appeal.respondent}${c.appeal.respondedAt ? ` responded ${iso(c.appeal.respondedAt)}` : ''}${c.appeal.decision ? `; result ${c.appeal.decision.result}` : ''}`);
  if (c.phase === 'Appealed') out(`  respond window until ${iso(deadlines.respondDeadline(c))}`);
  if (c.phase === 'UnderReview') out(`  review due by ${iso(deadlines.reviewDeadline(c))}`);
  const fin = c.phase !== 'Closed' ? deadlines.finality(c, now) : null;
  if (fin) out(`  final ${fin.outcome} since ${iso(fin.finalAt)} (${fin.mode}); release window until ${iso(deadlines.releaseDeadline(c, fin))}`);
  const t = c.phase !== 'Closed' ? closingTransition(c, now) : null;
  out(`  now ${iso(now)}: ${c.phase === 'Closed' ? `closed (${c.ending})` : t ? `a finalize now would close as ${t.ending}` : 'nothing to finalize yet'}`);
  return { case: c, now, closing: t ? t.ending : null };
}

export async function cmdRegisterKey(ctx) {
  const { pk } = requireSealKey(ctx, 'to register');
  const cur = await ctx.chain.view('get_key', { account: ctx.account });
  if (cur === toHex(pk)) { ctx.out(`${ctx.account}: sealing key ${short(cur)} already registered`); return { changed: false }; }
  await sendCall(ctx, 'register_key', { pubkey: toHex(pk) }, 0n);
  ctx.out(`${ctx.account}: sealing key ${toHex(pk)} registered (cases pin the requester key at creation, §5.5)`);
  return { changed: true };
}

export async function cmdWithdraw(ctx, o = {}) {
  const bal = BigInt(await ctx.chain.view('get_balance', { account: ctx.account }));
  if (bal === 0n) { ctx.out(`${ctx.account}: internal balance is 0`); return { amount: 0n }; }
  const amount = o.amount === undefined ? bal : BigInt(o.amount);
  await sendCall(ctx, 'withdraw', { amount: amount.toString() }, 0n);
  ctx.out(`${ctx.account}: withdrew ${yoctoAndNear(amount)} of ${yoctoAndNear(bal)}`);
  return { amount };
}

export { keypair };
