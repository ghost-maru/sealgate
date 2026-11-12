// Component ⑤ Registry (SPEC §1 table, §5.5, §8.2, §9.2, §10.2).
// Clerks (with model and fee registration values), TEE signers, sealing keys
// and templates. Registration values are copied into a case at creation, so
// later registry changes never affect a live case. Templates are immutable:
// a revision is a new version under the same id.

import {
  fail, accountArg, intArg, yoctoArg, strArg, hex32Arg, utf8Bytes, bytesToHex,
  W1_MIN_S, W1_MAX_S, CONSTRAINT_AMOUNT_ZERO, INPUT_SIDES,
} from './params.js';
import { MAX_BODY_LIMIT } from './fixing.js';

const STAGES = ['primary', 'panel', 'comparison'];

// --- sealing keys (one per account; replaceable, cases pin R's at creation) ---
export function registerKey(store, caller, args) {
  const pk = hex32Arg(args.pubkey, 'pubkey');
  store.putKey(caller, pk);
}
export function requireKey(store, account, who) {
  const k = store.getKey(account);
  if (!k) fail('E_NO_KEY', `${who} has not registered a sealing key`);
  return k;
}

// --- owner ---
export function requireOwner(store, caller) {
  if (caller !== store.getOwner()) fail('E_NOT_OWNER', 'only the owner may call this');
}

// --- TEE signers ---
export function registerSigner(store, args) {
  const algo = strArg(args.algo, 'algo', 32);
  if (!/^[a-z0-9_-]+$/.test(algo)) fail('E_ARG', 'algo must be lowercase alphanumeric');
  const address = strArg(args.address, 'address', 256).toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]+$/.test(address)) fail('E_ARG', 'address must be hex');
  const key = `${algo}:${address}`;
  const list = store.getSigners();
  if (!list.includes(key)) { list.push(key); store.putSigners(list); }
  return key;
}

// --- clerks (§10.2) ---
function stageArg(x, name) {
  if (!x || typeof x !== 'object') fail('E_ARG', `${name} is required`);
  return {
    pIn: yoctoArg(x.p_in, `${name}.p_in`).toString(),
    pOut: yoctoArg(x.p_out, `${name}.p_out`).toString(),
    maxTokens: intArg(x.max_tokens, `${name}.max_tokens`, 0),
    overheadTokens: intArg(x.overhead_tokens, `${name}.overhead_tokens`, 0),
  };
}

export function registerClerk(store, args) {
  const account = accountArg(args.account, 'account');
  const stagesIn = args.stages || {};
  const stages = {};
  for (const s of STAGES) stages[s] = stageArg(stagesIn[s], `stages.${s}`);
  const reg = {
    account,
    sealKey: hex32Arg(args.seal_key, 'seal_key'),
    w1Sec: intArg(args.w1_sec, 'w1_sec', W1_MIN_S, W1_MAX_S),
    base1: yoctoArg(args.base_1, 'base_1').toString(),
    baseA: yoctoArg(args.base_a, 'base_a').toString(),
    stages,
    feeAccount: accountArg(args.fee_account, 'fee_account'),
    // The panel model serves both the blind panel and the comparison stage (§10.2).
    primaryModel: strArg(args.primary_model, 'primary_model', 256),
    panelModel: strArg(args.panel_model, 'panel_model', 256),
    lCrit: intArg(args.l_crit, 'l_crit', 1, MAX_BODY_LIMIT),
    lSub: intArg(args.l_sub, 'l_sub', 1, MAX_BODY_LIMIT),
    lTpl: intArg(args.l_tpl, 'l_tpl', 1),
  };
  store.putClerk(account, reg);
  return reg;
}

export function requireClerk(store, account) {
  const reg = store.getClerk(account);
  if (!reg) fail('E_NOT_CLERK', `${account} is not a registered clerk`);
  return reg;
}

// --- templates (§5.5, §8.2) ---
const TEMPLATE_ID = /^[A-Za-z0-9._-]{1,64}$/;
export const templateKey = (clerk, id, version) => `${clerk}|${id}|${version}`;

// Canonical declarations: constraints (v7 defines only "amount_zero") and
// required inputs [(side, heading[, on_missing])] (§7.5). A missing
// submission-side input is always FAIL (the submitter's defect); a missing
// case-file-side input maps to the result the template declares, and the v7
// profile defines only PASS for that mapping (the "no decision" mapping would
// need a profile transition v7 does not have, §7.5).
export function canonicalDeclarations(args) {
  const cIn = args.constraints === undefined ? [] : args.constraints;
  if (!Array.isArray(cIn)) fail('E_ARG', 'constraints must be an array');
  const constraints = [];
  for (const c of cIn) {
    if (c !== CONSTRAINT_AMOUNT_ZERO) fail('E_DECLARATION', `unknown constraint kind ${JSON.stringify(c)} (v7 defines only "${CONSTRAINT_AMOUNT_ZERO}")`);
    if (constraints.includes(c)) fail('E_DECLARATION', 'duplicate constraint');
    constraints.push(c);
  }
  const rIn = args.required_inputs === undefined ? [] : args.required_inputs;
  if (!Array.isArray(rIn)) fail('E_ARG', 'required_inputs must be an array');
  const requiredInputs = [];
  for (const r of rIn) {
    if (!r || typeof r !== 'object') fail('E_DECLARATION', 'a required input is {side, heading[, on_missing]}');
    if (!INPUT_SIDES.includes(r.side)) fail('E_DECLARATION', 'required input side must be case_file or submission');
    const heading = strArg(r.heading, 'required input heading', 256);
    if (r.side === 'submission') {
      if (r.on_missing !== undefined) fail('E_DECLARATION', 'a missing submission-side input is always FAIL; on_missing is not declarable');
      requiredInputs.push({ side: r.side, heading });
    } else {
      if (r.on_missing !== 'PASS') fail('E_DECLARATION', 'a case_file-side input must declare on_missing: "PASS" (the only mapping the profile defines)');
      requiredInputs.push({ side: r.side, heading, on_missing: 'PASS' });
    }
  }
  return { constraints, required_inputs: requiredInputs };
}

// Bytes the registrant pays storage for: the body (UTF-8) and the canonical
// declarations (UTF-8 of their JSON serialization).
export function templateStorageBytes(body, declarations) {
  return utf8Bytes(body).length + utf8Bytes(JSON.stringify(declarations)).length;
}

// Validates and builds a new template version. Does not write: the profile
// writes after settlement accepted the storage deposit.
export function prepareTemplate(store, caller, args, sha256) {
  const reg = requireClerk(store, caller); // only an owner-registered clerk may register templates
  if (typeof args.template_id !== 'string' || !TEMPLATE_ID.test(args.template_id)) fail('E_ARG', 'template_id must match [A-Za-z0-9._-]{1,64}');
  if (typeof args.body !== 'string' || args.body.length === 0) fail('E_ARG', 'body must be a non-empty string');
  const bodyBytes = utf8Bytes(args.body);
  if (bodyBytes.length > reg.lTpl) fail('E_LENGTH', `template body exceeds the clerk's L_tpl (${reg.lTpl} bytes)`);
  const declarations = canonicalDeclarations(args);
  const version = store.getTemplateCount(caller, args.template_id) + 1; // versions start at 1
  const tpl = {
    clerk: caller, id: args.template_id, version,
    body: args.body, bodyLen: bodyBytes.length, bodyHash: bytesToHex(sha256(bodyBytes)),
    constraints: declarations.constraints, requiredInputs: declarations.required_inputs,
  };
  return { tpl, storageBytes: templateStorageBytes(args.body, declarations) };
}

export function commitTemplate(store, tpl) {
  // Immutability: a (clerk, id, version) slot is written exactly once.
  if (store.getTemplate(templateKey(tpl.clerk, tpl.id, tpl.version))) fail('E_TEMPLATE_IMMUTABLE', 'template version already registered');
  store.putTemplate(templateKey(tpl.clerk, tpl.id, tpl.version), tpl);
  store.putTemplateCount(tpl.clerk, tpl.id, tpl.version);
}

export function requireTemplate(store, clerk, id, version) {
  if (typeof id !== 'string') fail('E_ARG', 'template_id is required');
  intArg(version, 'template_version', 1);
  const tpl = store.getTemplate(templateKey(clerk, id, version));
  if (!tpl) fail('E_NO_TEMPLATE', `template ${id}@${version} is not registered by clerk ${clerk}`);
  return tpl;
}

// Constraint verification at create_case (§5.1, §5.5).
export function checkTemplateConstraints(tpl, { amount }) {
  for (const c of tpl.constraints) {
    if (c === CONSTRAINT_AMOUNT_ZERO && amount !== 0n) fail('E_TEMPLATE_CONSTRAINT', `template ${tpl.id}@${tpl.version} declares: amount must be 0`);
  }
}

// What a case pins at creation (§5.5): the clerk's whole registration and
// the template id + version (with its body hash and length, immutable anyway).
export function pinClerk(reg) { return JSON.parse(JSON.stringify(reg)); }
export function pinTemplate(tpl) {
  return { clerk: tpl.clerk, id: tpl.id, version: tpl.version, bodyHash: tpl.bodyHash, bodyLen: tpl.bodyLen, constraints: tpl.constraints.slice(), requiredInputs: tpl.requiredInputs.map((r) => ({ ...r })) };
}
