// Component ④ Settlement (SPEC §1 table, §5.3, §5.4, §6, §6.1, §7.6).
//
// THE ONLY MODULE THAT MOVES MONEY OR KEY MATERIAL. Accepting deposits,
// crediting the fee account, crediting recipients, releasing k2, refunding
// and withdrawing all happen here and nowhere else; other modules only
// supply the triggers (the profile chooses which settlement operation a
// transition calls, never what the operation means). Its fixed semantics:
//   - deposits are exact (one yocto off and the call fails);
//   - a fee deposit settles at posting: deposit = charge + refund;
//   - a paying transition carries k2, a non-paying one rejects it (§5.4);
//   - nothing is released before the result is final (the profile only
//     builds a closing plan from a computed finality);
//   - per case, money deposited (price, fee deposits, bonds) equals money
//     credited by the end (checked on every close).
// Storage fees are a separate account: kept by the contract, never refunded.

import {
  fail, yoctoArg, hex32Arg, hexToBytes, bytesToHex, minBig, maxBig, ceilDivBig,
  STORAGE_PRICE_PER_BYTE, RECORD_FEE, RESP0_PAD, BOND_DEFAULT_PERCENT, ZERO_AMOUNT_BOND_CAP,
} from './params.js';
import { maxBucketCiphertextLen } from './fixing.js';

const B = (x) => BigInt(x);

// ---------------------------------------------------------------- deposits

export function requireNoDeposit(attached) {
  if (attached !== 0n) fail('E_DEPOSIT', 'this method takes no deposit');
}
function requireExact(attached, expected, what) {
  if (attached !== expected) fail('E_DEPOSIT', `${what}: attached ${attached} yocto, required exactly ${expected}`);
}
export const storageFee = (bytes) => B(bytes) * STORAGE_PRICE_PER_BYTE;

// ------------------------------------------------------- fee arithmetic (§6.1)
// All lengths are on-chain byte lengths: |criteria ct|, |submission ct|,
// |template body|. Prices are integer yocto per token, so every term is an
// integer and no rounding arises.

export function inputBounds(clerk, critLen, subLen, tplLen) {
  const common = critLen + subLen + tplLen;
  const s = clerk.stages;
  return {
    in1: common + s.primary.overheadTokens,
    inP: common + s.panel.overheadTokens,
    inC: common + s.comparison.overheadTokens + RESP0_PAD + 3 * s.panel.maxTokens,
  };
}

export function capPrimaryOf(clerk, critLen, subLen, tplLen) {
  const { in1 } = inputBounds(clerk, critLen, subLen, tplLen);
  const p = clerk.stages.primary;
  return B(clerk.base1) + B(p.pIn) * B(in1) + B(p.pOut) * B(p.maxTokens);
}

export function capAppealOf(clerk, critLen, subLen, tplLen) {
  const { inP, inC } = inputBounds(clerk, critLen, subLen, tplLen);
  const p = clerk.stages.panel, k = clerk.stages.comparison;
  return B(clerk.baseA)
    + 3n * (B(p.pIn) * B(inP) + B(p.pOut) * B(p.maxTokens))
    + (B(k.pIn) * B(inC) + B(k.pOut) * B(k.maxTokens));
}

// One call's contribution: p_in * min(in, IN_s) + p_out * min(out, M_s).
function callCost(stage, bound, u) {
  return B(stage.pIn) * minBig(B(u.in), B(bound)) + B(stage.pOut) * minBig(B(u.out), B(stage.maxTokens));
}

// charge = min(CAP, base + sum over the calls in the posted record).
export function chargePrimaryOf(clerk, cap, lens, calls) {
  const { in1 } = inputBounds(clerk, lens.crit, lens.sub, lens.tpl);
  let sum = B(clerk.base1);
  for (const u of calls) sum += callCost(clerk.stages.primary, in1, u);
  return minBig(cap, sum);
}
export function chargeAppealOf(clerk, cap, lens, usage) {
  const { inP, inC } = inputBounds(clerk, lens.crit, lens.sub, lens.tpl);
  let sum = B(clerk.baseA);
  for (const u of usage.panel) sum += callCost(clerk.stages.panel, inP, u);
  for (const u of usage.comparison) sum += callCost(clerk.stages.comparison, inC, u); // skipped comparison: no term
  return minBig(cap, sum);
}

const caseLens = (c) => ({ crit: c.criteria.ctLen, sub: c.submission.ctLen, tpl: c.template.bodyLen });

// quote_fee (§5.5): the fee part of the deposit submit/appeal require.
export function quoteFee(c, kind, subLen) {
  if (kind === 'primary') return capPrimaryOf(c.clerk, c.criteria.ctLen, subLen, c.template.bodyLen);
  if (kind === 'appeal') return capAppealOf(c.clerk, c.criteria.ctLen, subLen, c.template.bodyLen);
  return fail('E_ARG', 'kind must be "primary" (CAP_1) or "appeal" (CAP_A)');
}

// ------------------------------------------------------------ bonds (§10.1)

// Floor = CAP_A at the maximum submission size (|sub| = L_sub, ciphertext at
// its maximum length for L_sub, §6.1).
export function bondFloorOf(clerk, critLen, tplLen) {
  return capAppealOf(clerk, critLen, maxBucketCiphertextLen(clerk.lSub), tplLen);
}
export function bondBounds(amount, floor) {
  const max = amount > 0n ? maxBig(floor, ceilDivBig(amount, 2n)) : maxBig(floor, ZERO_AMOUNT_BOND_CAP);
  const dflt = maxBig(floor, ceilDivBig(amount * BOND_DEFAULT_PERCENT, 100n));
  return { min: floor, max, dflt };
}
export function chooseBond(amount, floor, arg) {
  const b = bondBounds(amount, floor);
  if (arg === undefined || arg === null) return b.dflt;
  const bond = yoctoArg(arg, 'bond');
  if (bond < b.min) fail('E_BOND_FLOOR', `bond is below the floor CAP_A(L_sub) = ${b.min}`);
  if (bond > b.max) fail('E_BOND_CAP', `bond is above the cap ${b.max}`);
  return bond;
}

// --------------------------------------------------------------- balances

function credit(store, c, who, amt) {
  if (amt <= 0n) return;
  store.putBalance(who, store.getBalance(who) + amt);
  if (c) c.money.out = (B(c.money.out) + amt).toString();
}
function escrowIn(c, amt) { c.money.in = (B(c.money.in) + amt).toString(); }
function storageIn(c, amt) { c.money.storage = (B(c.money.storage) + amt).toString(); }

export function withdraw(store, who, amountArg) {
  const bal = store.getBalance(who);
  const amt = amountArg === undefined || amountArg === null ? bal : yoctoArg(amountArg, 'amount');
  if (amt <= 0n || amt > bal) fail('E_BALANCE', 'nothing to withdraw or amount exceeds the balance');
  store.putBalance(who, bal - amt);
  return amt; // the host transfers it
}

// --------------------------------------------------- per-transition deposits

// create_case: price + fixed record fee + storage of the written bytes.
export function acceptCaseDeposit(c, attached, storageBytes) {
  const amount = B(c.amount);
  const storage = RECORD_FEE + storageFee(storageBytes);
  requireExact(attached, amount + storage, 'create_case deposit (amount + record fee + storage)');
  c.money = { in: '0', out: '0', storage: '0' };
  escrowIn(c, amount);
  storageIn(c, storage);
}

// submit: CAP_1 for the actual submission length + storage of the written bytes.
export function acceptSubmitDeposit(c, attached, storageBytes) {
  const cap = capPrimaryOf(c.clerk, c.criteria.ctLen, c.submission.ctLen, c.template.bodyLen);
  const storage = storageFee(storageBytes);
  requireExact(attached, cap + storage, 'submit deposit (CAP_1 + storage)');
  c.fee1 = { deposit: cap.toString(), charge: null, refund: null };
  escrowIn(c, cap);
  storageIn(c, storage);
}

// post_decision / post_appeal_decision: the clerk's own storage only.
export function acceptPostingStorage(c, attached, storageBytes) {
  const storage = storageFee(storageBytes);
  requireExact(attached, storage, 'posting deposit (storage of the response ciphertext)');
  storageIn(c, storage);
}

// register_template: storage of the serialized template record, not tied to any case.
export function acceptTemplateStorage(attached, storageBytes) {
  requireExact(attached, storageFee(storageBytes), 'register_template deposit (storage of the template record)');
}

// appeal: bond + CAP_A for the actual submission length.
export function acceptAppealDeposit(c, attached) {
  const bond = B(c.bond);
  const cap = capAppealOf(c.clerk, c.criteria.ctLen, c.submission.ctLen, c.template.bodyLen);
  requireExact(attached, bond + cap, 'appeal deposit (bond + CAP_A)');
  c.appeal.bond = bond.toString();
  c.appeal.fee = { deposit: cap.toString(), charge: null, refund: null };
  escrowIn(c, bond + cap);
}

// respond: the same bond.
export function acceptRespondDeposit(c, attached) {
  const bond = B(c.bond);
  requireExact(attached, bond, 'respond deposit (bond)');
  c.appeal.respondentBond = bond.toString();
  escrowIn(c, bond);
}

// ---------------------------------------------- fee settlement at posting

export function settlePrimaryFee(store, c, calls) {
  const cap = B(c.fee1.deposit);
  const charge = chargePrimaryOf(c.clerk, cap, caseLens(c), calls);
  credit(store, c, c.clerk.feeAccount, charge);
  credit(store, c, c.submitter, cap - charge);
  c.fee1.charge = charge.toString();
  c.fee1.refund = (cap - charge).toString();
}

export function settleAppealFee(store, c, usage) {
  const cap = B(c.appeal.fee.deposit);
  const charge = chargeAppealOf(c.clerk, cap, caseLens(c), usage);
  credit(store, c, c.clerk.feeAccount, charge);
  credit(store, c, c.appeal.by, cap - charge);
  c.appeal.fee.charge = charge.toString();
  c.appeal.fee.refund = (cap - charge).toString();
}

function refundFeeDeposit(store, c, fee, payer) {
  credit(store, c, payer, B(fee.deposit));
  fee.charge = '0';
  fee.refund = fee.deposit;
}

// -------------------------------------------------------------- k2 (§5.4)

export function k2Supplied(args) {
  return !!args && args.k2 !== undefined && args.k2 !== null;
}
// Every call that does not pay the submitter rejects a supplied k2.
export function assertK2Absent(args) {
  if (k2Supplied(args)) fail('E_K2_UNEXPECTED', 'k2 is accepted only by a finalize that pays the submitter');
}

// ----------------------------------------------------------- closing a case
//
// plan (built by the profile from a computed finality or expiry):
//   priceTo:     'S' | 'R'   recipient of the price (amount)
//   refundFee1:  boolean     return CAP_1 in full to S (no primary posting)
//   appeal:      'none' | 'default' | 'silence' | 'overturned' | 'upheld'
//
// The k2 rule: a close that pays a positive amount (the price) to the
// submitter requires k2 with sha256(k2) == lock and records it in the same
// transaction; every other close rejects k2.
export function closeCase(store, c, plan, args, sha256) {
  const amount = B(c.amount);
  const pays = plan.priceTo === 'S' && amount > 0n;
  if (pays) {
    if (!k2Supplied(args)) fail('E_K2_REQUIRED', 'paying the submitter requires k2 (release window still open)');
    const k2 = hex32Arg(args.k2, 'k2');
    if (bytesToHex(sha256(hexToBytes(k2))) !== c.submission.lock) fail('E_K2_MISMATCH', 'sha256(k2) does not match the lock');
    c.k2 = k2; // the release: k2 goes on-chain in the paying transaction
  } else {
    assertK2Absent(args);
  }

  credit(store, c, plan.priceTo === 'S' ? c.submitter : c.requester, amount);
  if (plan.refundFee1) refundFeeDeposit(store, c, c.fee1, c.submitter);

  const a = c.appeal;
  switch (plan.appeal) {
    case 'none': break;
    case 'default': // no review: appellant's bond and the whole CAP_A return
      credit(store, c, a.by, B(a.bond));
      refundFeeDeposit(store, c, a.fee, a.by);
      break;
    case 'silence': // no review: both bonds return to their posters, CAP_A returns
      credit(store, c, a.by, B(a.bond));
      credit(store, c, a.respondent, B(a.respondentBond));
      refundFeeDeposit(store, c, a.fee, a.by);
      break;
    case 'overturned': // respondent's bond moves to the appellant
      credit(store, c, a.by, B(a.bond) + B(a.respondentBond));
      break;
    case 'upheld': // appellant's bond moves to the respondent
      credit(store, c, a.respondent, B(a.bond) + B(a.respondentBond));
      break;
    default: fail('E_INTERNAL', `unknown appeal ending ${plan.appeal}`);
  }

  // Conservation (§6): everything deposited into the case has been credited.
  if (B(c.money.in) !== B(c.money.out)) fail('E_INTERNAL', `conservation violated: in ${c.money.in} != out ${c.money.out}`);
  return pays;
}
