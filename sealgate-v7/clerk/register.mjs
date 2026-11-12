// Idempotent registration of the reference clerk and its initial templates
// (SPEC-v7-KERNEL §5.5, §8.2, §10.2, appendix A stage 2).
//
//   register_clerk     called by the contract OWNER (owner-only method)
//   register_template  called by the CLERK, deposit = storage of body + declarations
//
// Idempotence: the clerk is skipped when its stored registration equals the
// desired one; a differing registration is reported and only overwritten
// with updateClerk (it affects new cases only, §5.5). A template is skipped
// when some registered version of the same id has the same body hash and
// declarations. Otherwise a new version would be created; since the reference
// ids are inspection@1 / adjudication@1, registering a version > 1 needs
// allowNewVersion.

import { canonicalDeclarations, templateStorageBytes } from '../contract/src/kernel/registry.js';
import { STORAGE_PRICE_PER_BYTE } from '../contract/src/kernel/params.js';
import { sha256, utf8, toHex } from '../shared/seal.mjs';
import { REGISTRATION } from './config.mjs';
import { TEMPLATES } from './templates.mjs';

export function clerkArgs({ account, sealKeyHex, feeAccount, registration = REGISTRATION }) {
  return JSON.parse(JSON.stringify({ ...registration, account, seal_key: sealKeyHex, fee_account: feeAccount || account }));
}

// The stored registration (registry.js registerClerk) back in argument shape.
export function storedToArgs(r) {
  if (!r) return null;
  const st = (s) => ({ p_in: s.pIn, p_out: s.pOut, max_tokens: s.maxTokens, overhead_tokens: s.overheadTokens });
  return {
    account: r.account, seal_key: r.sealKey, w1_sec: r.w1Sec, base_1: r.base1, base_a: r.baseA,
    stages: { primary: st(r.stages.primary), panel: st(r.stages.panel), comparison: st(r.stages.comparison) },
    fee_account: r.feeAccount, primary_model: r.primaryModel, panel_model: r.panelModel,
    l_crit: r.lCrit, l_sub: r.lSub, l_tpl: r.lTpl,
  };
}

const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
export const sameClerkArgs = (a, b) => canon(a) === canon(b);

export function templateDeposit(t) {
  const decl = canonicalDeclarations(t.declarations);
  return BigInt(templateStorageBytes(t.body, decl)) * STORAGE_PRICE_PER_BYTE;
}
export const bodyHashOf = (body) => toHex(sha256(utf8(body)));

function sameTemplate(stored, t) {
  const decl = canonicalDeclarations(t.declarations);
  return stored.bodyHash === bodyHashOf(t.body)
    && JSON.stringify(stored.constraints) === JSON.stringify(decl.constraints)
    && JSON.stringify(stored.requiredInputs) === JSON.stringify(decl.required_inputs);
}

// ownerChain / clerkChain: chain handles signing as the owner / the clerk
// (clerk/chain.mjs). In dryRun, only views are made.
export async function ensureRegistered({ ownerChain, clerkChain, args, templates = TEMPLATES, dryRun = false, updateClerk = false, allowNewVersion = false, log = () => {} }) {
  const report = { clerk: null, templates: [] };

  const stored = storedToArgs(await clerkChain.view('get_clerk', { account: args.account }));
  if (stored && sameClerkArgs(stored, args)) {
    report.clerk = 'unchanged';
  } else if (stored && !updateClerk) {
    report.clerk = 'differs';
    log(`clerk ${args.account} is registered with different values; not overwriting (pass updateClerk to replace; affects new cases only)`);
  } else if (dryRun) {
    report.clerk = stored ? 'would-update' : 'would-register';
  } else {
    await ownerChain.call('register_clerk', args, 0n);
    report.clerk = stored ? 'updated' : 'registered';
  }
  log(`clerk ${args.account}: ${report.clerk}`);

  const clerkRegistered = report.clerk !== 'would-register';
  for (const t of templates) {
    const count = clerkRegistered ? await clerkChain.view('get_template_count', { clerk: args.account, template_id: t.template_id }) : 0;
    let found = null;
    for (let v = 1; v <= count && !found; v++) {
      const s = await clerkChain.view('get_template', { clerk: args.account, template_id: t.template_id, version: v });
      if (s && sameTemplate(s, t)) found = v;
    }
    const deposit = templateDeposit(t);
    const entry = { template_id: t.template_id, wanted: t.version, bodyHash: bodyHashOf(t.body), bytes: utf8(t.body).length, deposit: deposit.toString() };
    if (found) {
      Object.assign(entry, { status: 'unchanged', version: found });
      if (found !== t.version) log(`template ${t.template_id}: identical body registered as version ${found}, not ${t.version}`);
    } else if (count + 1 !== t.version && !allowNewVersion) {
      Object.assign(entry, { status: 'blocked', version: null, why: `registering now would create ${t.template_id}@${count + 1}, not @${t.version}` });
      log(`template ${t.template_id}: ${entry.why}; pass allowNewVersion to register anyway`);
    } else if (dryRun) {
      Object.assign(entry, { status: 'would-register', version: count + 1 });
    } else {
      const decl = canonicalDeclarations(t.declarations);
      const out = await clerkChain.call('register_template', { template_id: t.template_id, body: t.body, constraints: decl.constraints, required_inputs: decl.required_inputs }, deposit);
      Object.assign(entry, { status: 'registered', version: out && out.version !== undefined ? out.version : count + 1 });
    }
    log(`template ${t.template_id}: ${entry.status}${entry.version ? ` @${entry.version}` : ''}`);
    report.templates.push(entry);
  }
  return report;
}
