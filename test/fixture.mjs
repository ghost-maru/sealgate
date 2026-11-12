// Shared fixture for the machine tests: one owner, one clerk registered with
// round-number fee values (so CAP / charge arithmetic can be checked against
// hand-computed literals), the two initial templates, parties with keys, and
// length-correct random material (the contract only sees lengths and the lock).
import { createHash, randomBytes } from 'node:crypto';
import { Machine } from '../contract/machine.mjs';

export const NEAR = 10n ** 24n;
export const OWNER = 'owner.testnet';
export const CLERK = 'clerk.testnet';
export const FEES = 'fees.testnet';
export const R = 'alice.testnet';
export const S = 'bob.testnet';
export const X = 'carol.testnet'; // third party

export const T0 = 1_700_000_000_000;      // ms
export const HOUR = 3_600_000;
export const W = 24 * HOUR;                // default W
export const HALF_W = W / 2;
export const W1 = 12 * HOUR;

export const CLERK_REG = {
  account: CLERK,
  seal_key: '11'.repeat(32),
  w1_sec: 12 * 3600,
  base_1: '5000000000000000000000',      // 0.005 NEAR
  base_a: '20000000000000000000000',     // 0.02 NEAR
  stages: {
    primary:    { p_in: '100000000000000000', p_out: '400000000000000000', max_tokens: 2048, overhead_tokens: 1024 },
    panel:      { p_in: '50000000000000000',  p_out: '200000000000000000', max_tokens: 2048, overhead_tokens: 1024 },
    comparison: { p_in: '100000000000000000', p_out: '400000000000000000', max_tokens: 1024, overhead_tokens: 1024 },
  },
  fee_account: FEES,
  primary_model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
  panel_model: 'z-ai/glm-5.3-flash',
  l_crit: 8192, l_sub: 8192, l_tpl: 4096,
};

export const TPL_BODY = 'x'.repeat(1000); // 1000-byte template body
export const STORAGE = 10n ** 19n;
export const RECORD_FEE = 3n * 10n ** 22n;

export const b64 = (n) => randomBytes(n).toString('base64');
export const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
export const hex32 = () => randomBytes(32).toString('hex');

import { buildTemplateRecord, templateStorageBytes } from '../contract/src/kernel/registry.js';
export function templateStorage(body, declarations, id, version = 1, clerk = CLERK) {
  const tpl = buildTemplateRecord({ clerk, id, version, body, declarations, sha256: (b) => createHash('sha256').update(b).digest() });
  return BigInt(templateStorageBytes(tpl)) * STORAGE;
}
export const INSPECTION_DECL = { constraints: [], required_inputs: [] };
export const ADJUDICATION_DECL = { constraints: ['amount_zero'], required_inputs: [{ side: 'case_file', heading: '## Zeroth decision', on_missing: 'PASS' }] };

// Criteria ciphertext: 2000-byte criteria -> pad(16 + 2000) = 2048 -> 2088 bytes.
export const CRIT_CT_LEN = 2088;
// Submission ciphertext: 4000-byte submission -> pad(16 + 4000) = 4096 -> 4136 bytes.
export const SUB_CT_LEN = 4136;

export function setup({ clerkReg = CLERK_REG } = {}) {
  const m = new Machine({ owner: OWNER });
  m.call('register_clerk', { caller: OWNER, now: T0 }, clerkReg);
  m.call('register_template', { caller: CLERK, now: T0, deposit: templateStorage(TPL_BODY, INSPECTION_DECL, 'inspection') }, { template_id: 'inspection', body: TPL_BODY, ...INSPECTION_DECL });
  m.call('register_template', { caller: CLERK, now: T0, deposit: templateStorage(TPL_BODY, ADJUDICATION_DECL, 'adjudication') }, { template_id: 'adjudication', body: TPL_BODY, ...ADJUDICATION_DECL });
  for (const a of [R, S, X]) m.call('register_key', { caller: a, now: T0 }, { pubkey: hex32() });
  return { m };
}

export function createArgs(over = {}) {
  return {
    clerk: CLERK, template_id: 'inspection', template_version: 1,
    submitter: S, amount: (5n * NEAR).toString(),
    criteria_hash: hex32(), criteria_ct: b64(CRIT_CT_LEN), env_s: b64(80),
    submit_window_sec: 3 * 86400,
    ...over,
  };
}
const b64Stored = (n) => 4 * Math.ceil(n / 3);
export const createStorage = (critLen = CRIT_CT_LEN) => RECORD_FEE + BigInt(32 + b64Stored(critLen) + b64Stored(80)) * STORAGE;

export function createCase(m, over = {}, now = T0) {
  const args = createArgs(over);
  const id = m.call('create_case', { caller: R, now, deposit: BigInt(args.amount) + createStorage(b64len(args.criteria_ct)) }, args);
  return id;
}
export const b64len = (s) => Buffer.from(s, 'base64').length;

export function submitArgs(caseId, { subLen = SUB_CT_LEN } = {}) {
  const k2 = randomBytes(32);
  return {
    k2: k2.toString('hex'),
    args: { case_id: caseId, sub_hash: hex32(), sub_ct: b64(subLen), env_c: b64(144), env_r: b64(80), lock: sha256hex(k2) },
  };
}
export const submitStorage = (subLen = SUB_CT_LEN) => BigInt(32 + b64Stored(subLen) + b64Stored(144) + b64Stored(80) + 32) * STORAGE;

export function submitCase(m, id, now, { subLen = SUB_CT_LEN } = {}) {
  const { k2, args } = submitArgs(id, { subLen });
  const cap1 = BigInt(m.view('quote_fee', { case_id: id, kind: 'primary', sub_len: subLen }));
  m.call('submit', { caller: S, now, deposit: cap1 + submitStorage(subLen) }, args);
  return { k2, cap1 };
}

export const RESP0_STORAGE = 1400n * STORAGE; // stored base64 length of the 1048-byte container
export const RESP1_STORAGE = 10976n * STORAGE; // stored base64 length of the 8232-byte container

export function decide(m, id, verdict, now, usage = [{ in: 4096, out: 1024 }]) {
  m.call('post_decision', { caller: CLERK, now, deposit: RESP0_STORAGE }, { case_id: id, verdict, response: b64(1048), usage });
}
export function appealCase(m, id, by, now) {
  const c = m.getCase(id);
  const capA = BigInt(m.view('quote_fee', { case_id: id, kind: 'appeal', sub_len: c.submission.ctLen }));
  m.call('appeal', { caller: by, now, deposit: BigInt(c.bond) + capA }, { case_id: id });
  return capA;
}
export function respondCase(m, id, by, now) {
  const c = m.getCase(id);
  m.call('respond', { caller: by, now, deposit: BigInt(c.bond) }, { case_id: id });
}
export function decideAppeal(m, id, result, now, usage = { panel: [{ in: 8192, out: 1024 }, { in: 8192, out: 1024 }, { in: 8192, out: 1024 }], comparison: [{ in: 9216, out: 1024 }] }) {
  m.call('post_appeal_decision', { caller: CLERK, now, deposit: RESP1_STORAGE }, { case_id: id, result, record: b64(8232), usage });
}

export const finalize = (m, now, id, k2, caller = X) =>
  m.call('finalize', { caller, now }, k2 === undefined ? { case_id: id } : { case_id: id, k2 });

// Assert that `fn` throws an error whose message starts with `code`.
export function rejects(assert, fn, code) {
  assert.throws(fn, (e) => {
    if (!String(e.message).startsWith(code)) throw new Error(`expected ${code}, got: ${e.message}`);
    return true;
  });
}
