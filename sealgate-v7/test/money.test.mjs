// Money (SPEC-v7-KERNEL §6, §6.1, §10.1, §10.3): exact deposits, CAP formulas
// from on-chain lengths only, settlement at posting with 1,024-token usage
// units and the cap clamp, the bond floor at maximum submission size.
//
// Fixture values (fixture.mjs): base_1 = 5e21, base_A = 2e22;
// primary p_in 1e17 p_out 4e17 M 2048 P 1024; panel p_in 5e16 p_out 2e17
// M 2048 P 1024; comparison p_in 1e17 p_out 4e17 M 1024 P 1024.
// |criteria ct| = 2088, |submission ct| = 4136, |template| = 1000, L_sub = 8192.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEAR, CLERK, FEES, R, S, T0, HOUR, STORAGE, RECORD_FEE,
  setup, createArgs, createCase, createStorage, submitArgs, submitStorage, submitCase, decide,
  appealCase, respondCase, decideAppeal, finalize, rejects, b64, RESP0_STORAGE, RESP1_STORAGE,
  templateStorage, INSPECTION_DECL, TPL_BODY, CLERK_REG,
} from './fixture.mjs';

const SUB_AT = T0 + HOUR;
const DEC_AT = T0 + 2 * HOUR;
const E21 = 10n ** 21n;

// IN_1 = 2088 + 4136 + 1000 + 1024 = 8248
// CAP_1 = 5e21 + 1e17*8248 + 4e17*2048 = 5e21 + 8.248e20 + 8.192e20 = 6.644e21
const CAP_1 = 6_644n * 10n ** 18n;
// IN_p = 8248; IN_c = 7224 + 1024 + 1008 + 3*2048 = 15400
// CAP_A = 2e22 + 3*(5e16*8248 + 2e17*2048) + (1e17*15400 + 4e17*1024)
//       = 2e22 + 3*8.22e20 + 1.9496e21 = 2.44156e22
const CAP_A = 244_156n * 10n ** 17n;
// Max submission ciphertext for L_sub = 8192: pad(16 + 8192 + 2 -> 9 KB) + 40 = 9256.
// floor = CAP_A at 9256: IN_p = 13368, IN_c = 20520
//       = 2e22 + 3*(5e16*13368 + 2e17*2048) + (1e17*20520 + 4e17*1024) = 2.56956e22
const FLOOR = 256_956n * 10n ** 17n;

test('quote_fee: CAP_1 and CAP_A from on-chain lengths', () => {
  const { m } = setup();
  const id = createCase(m);
  assert.equal(BigInt(m.view('quote_fee', { case_id: id, kind: 'primary', sub_len: 4136 })), CAP_1);
  assert.equal(BigInt(m.view('quote_fee', { case_id: id, kind: 'appeal', sub_len: 4136 })), CAP_A);
  rejects(assert, () => m.view('quote_fee', { case_id: id, kind: 'other', sub_len: 4136 }), 'E_ARG');
});

test('bond floor = CAP_A at maximum submission size (salt 16 + length prefix push 8192 into a 9 KB bucket)', () => {
  const { m } = setup();
  const id = createCase(m);
  const c = m.getCase(id);
  assert.equal(BigInt(c.bondFloor), FLOOR);
  assert.equal(BigInt(m.view('quote_fee', { case_id: id, kind: 'appeal', sub_len: 9256 })), FLOOR);
  // A maximum-size submission is accepted and its CAP_A equals the floor; one bucket more is rejected.
  submitCase(m, id, SUB_AT, { subLen: 9256 });
  decide(m, id, 'FAIL', DEC_AT);
  assert.equal(appealCase(m, id, S, DEC_AT + 1), FLOOR);
  const { m: m2 } = setup();
  const id2 = createCase(m2);
  rejects(assert, () => submitCase(m2, id2, SUB_AT, { subLen: 10280 }), 'E_LENGTH');
  rejects(assert, () => submitCase(m2, id2, SUB_AT, { subLen: 4100 }), 'E_LENGTH');
});

test('bond: default max(floor, 20%), range [floor, cap], cap max(floor, amount/2) or max(floor, 1 NEAR) at amount 0', () => {
  const { m } = setup();
  const make = (over) => createCase(m, over);
  assert.equal(m.getCase(make({})).bond, (NEAR).toString()); // 20% of 5 NEAR
  assert.equal(BigInt(m.getCase(make({ amount: (NEAR / 100n).toString() })).bond), FLOOR); // 20% of 0.01 < floor
  assert.equal(BigInt(m.getCase(make({ amount: '0' })).bond), FLOOR);
  rejects(assert, () => make({ bond: (FLOOR - 1n).toString() }), 'E_BOND_FLOOR');
  assert.equal(BigInt(m.getCase(make({ bond: FLOOR.toString() })).bond), FLOOR);
  assert.equal(BigInt(m.getCase(make({ bond: (5n * NEAR / 2n).toString() })).bond), 5n * NEAR / 2n);
  rejects(assert, () => make({ bond: (5n * NEAR / 2n + 1n).toString() }), 'E_BOND_CAP');
  assert.equal(BigInt(m.getCase(make({ amount: '0', bond: NEAR.toString() })).bond), NEAR);
  rejects(assert, () => make({ amount: '0', bond: (NEAR + 1n).toString() }), 'E_BOND_CAP');
});

test('exact deposits: one yocto off is rejected at every paying method', () => {
  const { m } = setup();
  const args = createArgs();
  const want = BigInt(args.amount) + createStorage();
  assert.equal(createStorage(), RECORD_FEE + 2200n * STORAGE); // 0.03 + (32 + 2088 + 80) bytes
  for (const d of [want - 1n, want + 1n]) rejects(assert, () => m.call('create_case', { caller: R, now: T0, deposit: d }, args), 'E_DEPOSIT');
  const id = m.call('create_case', { caller: R, now: T0, deposit: want }, args);

  const { args: sargs } = submitArgs(id);
  const wantS = CAP_1 + submitStorage();
  assert.equal(submitStorage(), 4424n * STORAGE); // 32 + 4136 + 144 + 80 + 32 bytes
  for (const d of [wantS - 1n, wantS + 1n, submitStorage()]) rejects(assert, () => m.call('submit', { caller: S, now: SUB_AT, deposit: d }, sargs), 'E_DEPOSIT');
  m.call('submit', { caller: S, now: SUB_AT, deposit: wantS }, sargs);

  const post = (d) => m.call('post_decision', { caller: CLERK, now: DEC_AT, deposit: d }, { case_id: id, verdict: 'FAIL', response: b64(1048), usage: [] });
  for (const d of [RESP0_STORAGE - 1n, RESP0_STORAGE + 1n, 0n]) rejects(assert, () => post(d), 'E_DEPOSIT');
  post(RESP0_STORAGE);

  const bond = BigInt(m.getCase(id).bond);
  for (const d of [bond + CAP_A - 1n, bond + CAP_A + 1n, bond]) rejects(assert, () => m.call('appeal', { caller: S, now: DEC_AT + 1, deposit: d }, { case_id: id }), 'E_DEPOSIT');
  m.call('appeal', { caller: S, now: DEC_AT + 1, deposit: bond + CAP_A }, { case_id: id });
  for (const d of [bond - 1n, bond + 1n]) rejects(assert, () => m.call('respond', { caller: R, now: DEC_AT + 2, deposit: d }, { case_id: id }), 'E_DEPOSIT');
  m.call('respond', { caller: R, now: DEC_AT + 2, deposit: bond }, { case_id: id });

  const postA = (d) => m.call('post_appeal_decision', { caller: CLERK, now: DEC_AT + 3, deposit: d }, { case_id: id, result: 'FAIL', record: b64(8232), usage: {} });
  for (const d of [RESP1_STORAGE - 1n, RESP1_STORAGE + 1n]) rejects(assert, () => postA(d), 'E_DEPOSIT');
  postA(RESP1_STORAGE);

  rejects(assert, () => m.call('finalize', { caller: R, now: DEC_AT + 4, deposit: 1n }, { case_id: id }), 'E_DEPOSIT');
  finalize(m, DEC_AT + 4, id);

  const tplWant = templateStorage(TPL_BODY, INSPECTION_DECL);
  for (const d of [tplWant - 1n, tplWant + 1n]) rejects(assert, () => m.call('register_template', { caller: CLERK, now: T0, deposit: d }, { template_id: 'inspection', body: TPL_BODY }), 'E_DEPOSIT');

  // Storage is a separate account: kept by the contract, not part of the case's escrow.
  const c = m.getCase(id);
  assert.equal(BigInt(c.money.storage), createStorage() + submitStorage() + RESP0_STORAGE + RESP1_STORAGE);
  assert.equal(c.money.in, c.money.out);
});

test('primary settlement: declared usage in 1,024-token units, charge -> fee account, CAP_1 - charge -> S', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  const sBefore = m.balance(S);
  // Exact usage in 3,100 / out 412 is declared as 4,096 / 1,024 (§6.1 example).
  rejects(assert, () => decide(m, id, 'PASS', DEC_AT, [{ in: 3100, out: 412 }]), 'E_USAGE_UNIT');
  rejects(assert, () => decide(m, id, 'PASS', DEC_AT, [{ in: 4096, out: 412 }]), 'E_USAGE_UNIT');
  decide(m, id, 'PASS', DEC_AT, [{ in: 4096, out: 1024 }]);
  // charge = 5e21 + 1e17*4096 + 4e17*1024 = 5.8192e21
  const charge = 58_192n * 10n ** 17n;
  const c = m.getCase(id);
  assert.equal(BigInt(c.fee1.charge), charge);
  assert.equal(BigInt(c.fee1.refund), CAP_1 - charge);
  assert.equal(m.balance(FEES), charge);
  assert.equal(m.balance(S) - sBefore, CAP_1 - charge);
});

test('cap clamp: usage beyond IN_s / M_s is clamped per call, and the charge never exceeds CAP', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'PASS', DEC_AT, [{ in: 1024 * 1000, out: 1024 * 1000 }]);
  const c = m.getCase(id);
  assert.equal(BigInt(c.fee1.charge), CAP_1);
  assert.equal(c.fee1.refund, '0');

  const { m: m2 } = setup();
  const id2 = createCase(m2);
  submitCase(m2, id2, SUB_AT);
  decide(m2, id2, 'FAIL', DEC_AT);
  appealCase(m2, id2, S, DEC_AT + 1);
  respondCase(m2, id2, R, DEC_AT + 2);
  const huge = { in: 1024 * 1000, out: 1024 * 1000 };
  decideAppeal(m2, id2, 'FAIL', DEC_AT + 3, { panel: [huge, huge, huge], comparison: [huge] });
  assert.equal(BigInt(m2.getCase(id2).appeal.fee.charge), CAP_A);
  assert.equal(m2.getCase(id2).appeal.fee.refund, '0');
});

test('formal-defect posting (no model call): usage 0, charge = base_1 only', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'FAIL', DEC_AT, []);
  const c = m.getCase(id);
  assert.equal(BigInt(c.fee1.charge), 5n * E21);
  assert.equal(BigInt(c.fee1.charge) + BigInt(c.fee1.refund), CAP_1);
});

test('only calls included in the record are charged: at most 1 primary, 3 panel, 1 comparison', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  const u = { in: 1024, out: 1024 };
  rejects(assert, () => decide(m, id, 'PASS', DEC_AT, [u, u]), 'E_TOO_MANY_CALLS');
  decide(m, id, 'FAIL', DEC_AT, [u]);
  appealCase(m, id, S, DEC_AT + 1);
  respondCase(m, id, R, DEC_AT + 2);
  rejects(assert, () => decideAppeal(m, id, 'PASS', DEC_AT + 3, { panel: [u, u, u, u], comparison: [] }), 'E_TOO_MANY_CALLS');
  rejects(assert, () => decideAppeal(m, id, 'PASS', DEC_AT + 3, { panel: [u, u, u], comparison: [u, u] }), 'E_TOO_MANY_CALLS');
  rejects(assert, () => decideAppeal(m, id, 'PASS', DEC_AT + 3, { panel: [u], retry: [u] }), 'E_ARG');
});

test('partial panel and skipped comparison: charged only for the posted calls', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'FAIL', DEC_AT);
  appealCase(m, id, S, DEC_AT + 1);
  respondCase(m, id, R, DEC_AT + 2);
  const sBefore = m.balance(S), feesBefore = m.balance(FEES);
  // Two panel calls (in 8192 <= IN_p, out 1024 <= M_p), comparison skipped:
  // charge = 2e22 + 2*(5e16*8192 + 2e17*1024) = 2e22 + 2*6.144e20 = 2.12288e22
  decideAppeal(m, id, 'FAIL', DEC_AT + 3, { panel: [{ in: 8192, out: 1024 }, { in: 8192, out: 1024 }], comparison: [] });
  const charge = 212_288n * 10n ** 17n;
  const a = m.getCase(id).appeal;
  assert.equal(BigInt(a.fee.charge), charge);
  assert.equal(BigInt(a.fee.refund), CAP_A - charge);
  assert.equal(m.balance(FEES) - feesBefore, charge);
  assert.equal(m.balance(S) - sBefore, CAP_A - charge); // refund goes to the appellant
});

test('full appeal charge: 3 panel calls and 1 comparison call, with the comparison input bound IN_c', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'PASS', DEC_AT);
  appealCase(m, id, R, DEC_AT + 1);
  respondCase(m, id, S, DEC_AT + 2);
  const p = { in: 8192, out: 2048 };
  const rBefore = m.balance(R);
  // IN_c = |criteria ct| + |submission ct| + |template| + P_c + 1008 + 3*M_p
  //      = 2088 + 4136 + 1000 + 1024 + 1008 + 3*2048 = 15400
  // comparison in = 16384 > IN_c = 15400 -> clamped to 15400; out 1024 = M_c
  decideAppeal(m, id, 'FAIL', DEC_AT + 3, { panel: [p, p, p], comparison: [{ in: 16384, out: 1024 }] });
  // panel call (in 8192 <= IN_p 8248, out 2048 = M_p): 5e16*8192 + 2e17*2048 = 4.096e20 + 4.096e20 = 8.192e20
  // three panel calls: 3*8.192e20 = 2.4576e21
  // comparison call: 1e17*15400 + 4e17*1024 = 1.54e21 + 4.096e20 = 1.9496e21
  // charge = base_A + panel + comparison = 2e22 + 2.4576e21 + 1.9496e21 = 2.44072e22 (< CAP_A 2.44156e22, no cap)
  const charge = 244_072n * 10n ** 17n;
  assert.equal(BigInt(m.getCase(id).appeal.fee.charge), charge);
  assert.equal(m.balance(R) - rBefore, CAP_A - charge); // R appealed, R gets the refund
});

test('fee settlement happens in the posting transaction; a posted charge never comes back', () => {
  const { m } = setup();
  const id = createCase(m);
  submitCase(m, id, SUB_AT);
  decide(m, id, 'FAIL', DEC_AT);
  const charge1 = BigInt(m.getCase(id).fee1.charge);
  appealCase(m, id, S, DEC_AT + 1);
  respondCase(m, id, R, DEC_AT + 2);
  decideAppeal(m, id, 'PASS', DEC_AT + 3); // overturned
  const chargeA = BigInt(m.getCase(id).appeal.fee.charge);
  assert.equal(m.balance(FEES), charge1 + chargeA);
  // The closing (here: PASS unreleased after the window) moves price and bonds, never the charges.
  finalize(m, DEC_AT + 3 + 12 * HOUR + 1, id);
  assert.equal(m.balance(FEES), charge1 + chargeA);
  assert.equal(m.getCase(id).ending, 'PASS_UNRELEASED');
});

test('conservation: every deposit into a case is credited by its close, across all endings', () => {
  // Total internal balances after close = all escrowed money; the contract keeps only storage fees.
  const { m } = setup();
  const id = createCase(m);
  const { k2 } = submitCase(m, id, SUB_AT);
  decide(m, id, 'FAIL', DEC_AT);
  appealCase(m, id, S, DEC_AT + 1);
  respondCase(m, id, R, DEC_AT + 2);
  decideAppeal(m, id, 'PASS', DEC_AT + 3);
  finalize(m, DEC_AT + 3, id, k2);
  const c = m.getCase(id);
  const deposited = BigInt(c.amount) + BigInt(c.fee1.deposit) + BigInt(c.appeal.fee.deposit) + 2n * BigInt(c.bond);
  assert.equal(BigInt(c.money.in), deposited);
  assert.equal(m.totalBalances(), deposited);
  assert.equal(BigInt(c.fee1.deposit), BigInt(c.fee1.charge) + BigInt(c.fee1.refund));
  assert.equal(BigInt(c.appeal.fee.deposit), BigInt(c.appeal.fee.charge) + BigInt(c.appeal.fee.refund));
});

test('quote_fee follows the clerk values pinned at creation, not later registry changes', () => {
  const { m } = setup();
  const id = createCase(m);
  m.call('register_clerk', { caller: 'owner.testnet', now: T0 + 1 }, { ...CLERK_REG, base_1: '9' + CLERK_REG.base_1 });
  assert.equal(BigInt(m.view('quote_fee', { case_id: id, kind: 'primary', sub_len: 4136 })), CAP_1);
  const id2 = createCase(m);
  assert.notEqual(BigInt(m.view('quote_fee', { case_id: id2, kind: 'primary', sub_len: 4136 })), CAP_1);
});
