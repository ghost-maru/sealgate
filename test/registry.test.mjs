// Registry (SPEC §5.5, §8.2, §10.2): clerks with model and fee
// registration values, signers, sealing keys, the template registry keyed by
// (clerk, template id) with contract-assigned versions, and what a case pins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registry, METHODS } from '../contract/machine.mjs';
import {
  NEAR, OWNER, CLERK, R, S, X, T0, setup, createArgs, createCase, createStorage, rejects, hex32,
  templateStorage, INSPECTION_DECL, ADJUDICATION_DECL, TPL_BODY, CLERK_REG, b64,
} from './fixture.mjs';

const regTemplate = (m, caller, id, body, decl = INSPECTION_DECL, deposit = templateStorage(body, decl)) =>
  m.call('register_template', { caller, now: T0, deposit }, { template_id: id, body, ...decl });

test('register_clerk / register_signer are owner-only; clerk values are validated', () => {
  const { m } = setup();
  rejects(assert, () => m.call('register_clerk', { caller: R, now: T0 }, { ...CLERK_REG, account: 'clerk2.testnet' }), 'E_NOT_OWNER');
  rejects(assert, () => m.call('register_signer', { caller: R, now: T0 }, { algo: 'ecdsa', address: '0xAB' }), 'E_NOT_OWNER');
  m.call('register_signer', { caller: OWNER, now: T0 }, { algo: 'ecdsa', address: '0xAB' });
  m.call('register_signer', { caller: OWNER, now: T0 }, { algo: 'ecdsa', address: 'ab' });
  assert.deepEqual(m.view('get_signers'), ['ecdsa:ab']);
  rejects(assert, () => m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, w1_sec: 1799 }), 'E_RANGE');
  rejects(assert, () => m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, w1_sec: 7 * 86400 + 1 }), 'E_RANGE');
  rejects(assert, () => m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, base_1: '-1' }), 'E_ARG');
  rejects(assert, () => m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, stages: { primary: CLERK_REG.stages.primary } }), 'E_ARG');
  rejects(assert, () => m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, l_sub: 65535 }), 'E_RANGE');
  const c = m.view('get_clerk', { account: CLERK });
  assert.equal(c.primaryModel, 'Qwen/Qwen3-VL-30B-A3B-Instruct');
  assert.equal(c.panelModel, 'z-ai/glm-5.3-flash');
  assert.equal(c.w1Sec, 43200);
  assert.deepEqual([c.lCrit, c.lSub, c.lTpl], [8192, 8192, 4096]);
  assert.equal(c.stages.comparison.maxTokens, 1024);
});

test('register_template: only a registered clerk; versions start at 1 per (clerk, id); body hash recorded', () => {
  const { m } = setup();
  rejects(assert, () => regTemplate(m, X, 'inspection', TPL_BODY), 'E_NOT_CLERK');
  rejects(assert, () => regTemplate(m, OWNER, 'inspection', TPL_BODY), 'E_NOT_CLERK'); // the owner does not register templates
  const v1 = m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 1 });
  assert.equal(v1.version, 1);
  assert.equal(v1.bodyHash, createHash('sha256').update(TPL_BODY).digest('hex'));
  assert.equal(v1.bodyLen, 1000);
  const out = regTemplate(m, CLERK, 'inspection', 'revised body');
  assert.equal(out.version, 2);
  assert.equal(m.view('get_template_count', { clerk: CLERK, template_id: 'inspection' }), 2);
  // Version 1 is unchanged (immutability): a revision never overwrites.
  assert.deepEqual(m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 1 }), v1);
  assert.equal(m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 2 }).body, 'revised body');
  // Versions count per id: a new id starts at 1 again.
  assert.equal(regTemplate(m, CLERK, 'grant-review', 'body').version, 1);
});

test('templates are immutable: no method updates or deletes one, and a used slot cannot be rewritten', () => {
  const { m } = setup();
  const mutators = Object.keys(METHODS).filter((n) => /template/.test(n) && n !== 'register_template');
  assert.deepEqual(mutators, []);
  const tpl = m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 1 });
  rejects(assert, () => registry.commitTemplate(m.store, { ...tpl, body: 'tampered' }), 'E_TEMPLATE_IMMUTABLE');
  assert.equal(m.view('get_template', { clerk: CLERK, template_id: 'inspection', version: 1 }).body, TPL_BODY);
});

test('template body limit is the clerk\'s L_tpl at registration time', () => {
  const { m } = setup();
  const exact = 'a'.repeat(4096);
  assert.equal(regTemplate(m, CLERK, 'big', exact).version, 1);
  rejects(assert, () => regTemplate(m, CLERK, 'big', exact + 'a'), 'E_LENGTH');
  // Multi-byte characters are counted in UTF-8 bytes: 1366 * 3 = 4098 > 4096.
  rejects(assert, () => regTemplate(m, CLERK, 'big', 'あ'.repeat(1366)), 'E_LENGTH');
  // Lowering L_tpl later does not touch registered templates; new registrations use the new value.
  m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, l_tpl: 100 });
  assert.equal(m.view('get_template', { clerk: CLERK, template_id: 'big', version: 1 }).bodyLen, 4096);
  rejects(assert, () => regTemplate(m, CLERK, 'big', 'a'.repeat(101)), 'E_LENGTH');
  createCase(m, { template_id: 'big' });
});

test('declarations: v7 knows only the "amount must be 0" constraint; required inputs are (side, heading)', () => {
  const { m } = setup();
  rejects(assert, () => regTemplate(m, CLERK, 't', 'b', { constraints: ['amount_max'], required_inputs: [] }), 'E_DECLARATION');
  rejects(assert, () => regTemplate(m, CLERK, 't', 'b', { constraints: ['amount_zero', 'amount_zero'], required_inputs: [] }), 'E_DECLARATION');
  rejects(assert, () => regTemplate(m, CLERK, 't', 'b', { constraints: [], required_inputs: [{ side: 'case_file', heading: 'H' }] }), 'E_DECLARATION');
  rejects(assert, () => regTemplate(m, CLERK, 't', 'b', { constraints: [], required_inputs: [{ side: 'case_file', heading: 'H', on_missing: 'NO_DECISION' }] }), 'E_DECLARATION');
  rejects(assert, () => regTemplate(m, CLERK, 't', 'b', { constraints: [], required_inputs: [{ side: 'submission', heading: 'H', on_missing: 'PASS' }] }), 'E_DECLARATION');
  rejects(assert, () => regTemplate(m, CLERK, 't', 'b', { constraints: [], required_inputs: [{ side: 'elsewhere', heading: 'H' }] }), 'E_DECLARATION');
  const decl = { constraints: [], required_inputs: [{ side: 'submission', heading: '## Evidence' }] };
  assert.equal(regTemplate(m, CLERK, 't', 'b', decl).version, 1);
  const a = m.view('get_template', { clerk: CLERK, template_id: 'adjudication', version: 1 });
  assert.deepEqual(a.constraints, ['amount_zero']);
  assert.deepEqual(a.requiredInputs, ADJUDICATION_DECL.required_inputs);
});

test('create_case: adjudication with amount > 0 is rejected; amount 0 accepted', () => {
  const { m } = setup();
  rejects(assert, () => createCase(m, { template_id: 'adjudication' }), 'E_TEMPLATE_CONSTRAINT');
  rejects(assert, () => createCase(m, { template_id: 'adjudication', amount: '1' }), 'E_TEMPLATE_CONSTRAINT');
  const id = createCase(m, { template_id: 'adjudication', amount: '0' });
  assert.equal(m.getCase(id).template.id, 'adjudication');
  // inspection has no constraint
  createCase(m, { amount: '0' });
  createCase(m, { amount: (7n * NEAR).toString() });
});

test('create_case names only a template registered by its pinned clerk', () => {
  const { m } = setup();
  m.call('register_clerk', { caller: OWNER, now: T0 }, { ...CLERK_REG, account: 'clerk2.testnet' });
  regTemplate(m, 'clerk2.testnet', 'special', 'body');
  rejects(assert, () => createCase(m, { template_id: 'special' }), 'E_NO_TEMPLATE');            // clerk.testnet never registered it
  rejects(assert, () => createCase(m, { template_version: 2 }), 'E_NO_TEMPLATE');               // unregistered version
  rejects(assert, () => createCase(m, { clerk: 'nobody.testnet' }), 'E_NOT_CLERK');
  const id = createCase(m, { clerk: 'clerk2.testnet', template_id: 'special' });
  assert.equal(m.getCase(id).clerk.account, 'clerk2.testnet');
});

test('create_case pins R\'s key, the clerk registration and the template; later registry changes do not apply', () => {
  const { m } = setup();
  const rKey = m.view('get_key', { account: R });
  const id = createCase(m);
  m.call('register_key', { caller: R, now: T0 + 1 }, { pubkey: hex32() });
  m.call('register_clerk', { caller: OWNER, now: T0 + 1 }, { ...CLERK_REG, seal_key: '22'.repeat(32), primary_model: 'other/model', w1_sec: 1800 });
  regTemplate(m, CLERK, 'inspection', 'v2 body');
  const c = m.getCase(id);
  assert.equal(c.requesterKey, rKey);
  assert.equal(c.clerk.sealKey, '11'.repeat(32));
  assert.equal(c.clerk.primaryModel, 'Qwen/Qwen3-VL-30B-A3B-Instruct');
  assert.equal(c.clerk.w1Sec, 43200);
  assert.deepEqual([c.template.id, c.template.version, c.template.bodyLen], ['inspection', 1, 1000]);
  const id2 = createCase(m);
  assert.equal(m.getCase(id2).clerk.primaryModel, 'other/model');
  assert.notEqual(m.getCase(id2).requesterKey, rKey);
});

test('create_case parties, keys, windows and criteria lengths', () => {
  const { m } = setup();
  rejects(assert, () => createCase(m, { submitter: R }), 'E_PARTY');
  rejects(assert, () => createCase(m, { submitter: CLERK }), 'E_PARTY');
  rejects(assert, () => createCase(m, { submitter: 'nokey.testnet' }), 'E_NO_KEY');
  rejects(assert, () => createCase(m, { w_sec: 3599 }), 'E_RANGE');
  rejects(assert, () => createCase(m, { w_sec: 30 * 86400 + 1 }), 'E_RANGE');
  rejects(assert, () => createCase(m, { submit_window_sec: 3599 }), 'E_RANGE');
  rejects(assert, () => createCase(m, { submit_window_sec: 180 * 86400 + 1 }), 'E_RANGE');
  rejects(assert, () => createCase(m, { submit_window_sec: undefined }), 'E_ARG');
  assert.equal(m.getCase(createCase(m, { w_sec: 3600 })).wMs, 3_600_000);
  assert.equal(m.getCase(createCase(m)).wMs, 86_400_000); // default W = 24h
  // Criteria ciphertext: 40 + k*1024 bytes, at most the L_crit maximum (9256 for 8192).
  rejects(assert, () => createCase(m, { criteria_ct: b64(2000) }), 'E_LENGTH');
  rejects(assert, () => createCase(m, { criteria_ct: b64(40) }), 'E_LENGTH');
  rejects(assert, () => createCase(m, { criteria_ct: b64(10280) }), 'E_LENGTH');
  createCase(m, { criteria_ct: b64(9256) });
  rejects(assert, () => createCase(m, { env_s: b64(81) }), 'E_LENGTH');
  rejects(assert, () => createCase(m, { criteria_hash: 'AB'.repeat(32) }), 'E_ARG');
  // A requester without a key cannot create (its key must be pinned).
  const args = createArgs();
  rejects(assert, () => m.call('create_case', { caller: 'nokey.testnet', now: T0, deposit: BigInt(args.amount) + createStorage() }, args), 'E_NO_KEY');
});

test('expected_case_id guards the case id bound into the context string', () => {
  const { m } = setup();
  const next = m.view('next_case_id');
  rejects(assert, () => createCase(m, { expected_case_id: next + 1 }), 'E_CASE_ID');
  assert.equal(createCase(m, { expected_case_id: next }), next);
  assert.equal(m.view('next_case_id'), next + 1);
});

test('sealing keys: one per account, replaceable, 32-byte hex', () => {
  const { m } = setup();
  rejects(assert, () => m.call('register_key', { caller: X, now: T0 }, { pubkey: 'zz' }), 'E_ARG');
  const k = hex32();
  m.call('register_key', { caller: X, now: T0 }, { pubkey: k });
  assert.equal(m.view('get_key', { account: X }), k);
  assert.equal(m.view('get_key', { account: S }).length, 64);
});
