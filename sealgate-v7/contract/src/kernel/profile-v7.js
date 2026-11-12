// The v7 profile (SPEC-v7-KERNEL §5): the fixed wiring of the six framework
// components into the single-case lifecycle. Two parties, one submission, a
// verdict, at most one appeal, a simultaneous exchange. This file decides
// roles, stage order and conditions, and which component each transition
// calls; it never moves money or key material itself (only settlement.js
// does) and never reinterprets what a component does.
//
// Hosts: the NEAR contract (contract.ts) and the in-memory reference machine
// (../../machine.mjs) both run exactly this code. A host supplies
//   store: persistence (see machine.mjs for the interface)
//   ctx:   { caller, deposit (bigint yocto), now (ms), sha256 (Uint8Array -> Uint8Array) }
//
// Case phases (stored): AwaitingSubmission -> AwaitingDecision -> Decided
//   -> [Appealed -> UnderReview -> Reviewed] -> Closed.
// "Final" is computed, never stored (deadlines.finality, §5.2).

import {
  fail, accountArg, intArg, yoctoArg,
  W_DEFAULT_S, W_MIN_S, W_MAX_S, SUBMIT_MIN_S, SUBMIT_MAX_S,
} from './params.js';
import * as fixing from './fixing.js';
import * as judgment from './judgment.js';
import * as appeal from './appeal.js';
import * as settlement from './settlement.js';
import * as registry from './registry.js';
import * as deadlines from './deadlines.js';

function loadCase(store, id) {
  intArg(id, 'case_id', 0);
  const c = store.getCase(id);
  if (!c) fail('E_NO_CASE', `no case ${id}`);
  return c;
}
function requirePhase(c, phase, action) {
  if (c.phase !== phase) fail('E_PHASE', `cannot ${action} in phase ${c.phase}`);
}
// Calls other than finalize never take k2 (§5.4). Checked first, so the
// rejection code is the same whatever else is wrong with the call.
function noK2(args) { settlement.assertK2Absent(args); }

// ------------------------------------------------------------- registry

function register_key(store, ctx, args) {
  noK2(args); settlement.requireNoDeposit(ctx.deposit);
  registry.registerKey(store, ctx.caller, args);
}

function register_clerk(store, ctx, args) {
  noK2(args); settlement.requireNoDeposit(ctx.deposit);
  registry.requireOwner(store, ctx.caller);
  registry.registerClerk(store, args);
}

function register_signer(store, ctx, args) {
  noK2(args); settlement.requireNoDeposit(ctx.deposit);
  registry.requireOwner(store, ctx.caller);
  return registry.registerSigner(store, args);
}

function register_template(store, ctx, args) {
  noK2(args);
  const { tpl, storageBytes } = registry.prepareTemplate(store, ctx.caller, args, ctx.sha256);
  settlement.acceptTemplateStorage(ctx.deposit, storageBytes);
  registry.commitTemplate(store, tpl);
  store.log(`template ${tpl.clerk}/${tpl.id}@${tpl.version} registered (sha256 ${tpl.bodyHash})`);
  return { template_id: tpl.id, version: tpl.version, body_hash: tpl.bodyHash };
}

// ------------------------------------------------------------- lifecycle

function create_case(store, ctx, args) {
  noK2(args);
  const requester = ctx.caller;
  const clerkAcct = accountArg(args.clerk, 'clerk');
  const clerkReg = registry.requireClerk(store, clerkAcct);
  const tpl = registry.requireTemplate(store, clerkAcct, args.template_id, args.template_version);
  const amount = yoctoArg(args.amount, 'amount');
  registry.checkTemplateConstraints(tpl, { amount });
  const submitter = accountArg(args.submitter, 'submitter');
  if (submitter === requester) fail('E_PARTY', 'the submitter must differ from the requester');
  if (submitter === clerkAcct) fail('E_PARTY', 'the submitter must not be the clerk');
  const requesterKey = registry.requireKey(store, requester, 'the requester');
  registry.requireKey(store, submitter, 'the submitter');
  const wSec = args.w_sec === undefined ? W_DEFAULT_S : intArg(args.w_sec, 'w_sec', W_MIN_S, W_MAX_S);
  const submitSec = intArg(args.submit_window_sec, 'submit_window_sec', SUBMIT_MIN_S, SUBMIT_MAX_S);
  const fixed = fixing.fixCriteria(args, clerkReg.lCrit);

  const id = store.peekCaseId();
  // The context string binds the case id (§7.3), so the requester encrypts
  // for a predicted id; an optional expected_case_id turns a lost race into
  // a rejected call instead of a case whose material cannot be opened.
  if (args.expected_case_id !== undefined && args.expected_case_id !== id) fail('E_CASE_ID', `the next case id is ${id}`);

  const pinnedClerk = registry.pinClerk(clerkReg);
  const pinnedTpl = registry.pinTemplate(tpl);
  const floor = settlement.bondFloorOf(pinnedClerk, fixed.record.ctLen, pinnedTpl.bodyLen);
  const bond = settlement.chooseBond(amount, floor, args.bond);

  const c = {
    id, requester, submitter,
    clerk: pinnedClerk, template: pinnedTpl, requesterKey,
    amount: amount.toString(), bond: bond.toString(), bondFloor: floor.toString(),
    wMs: wSec * 1000, createdAt: ctx.now, submitDeadline: ctx.now + submitSec * 1000,
    criteria: fixed.record, submission: null, fee1: null, decision: null, appeal: null,
    phase: 'AwaitingSubmission', ending: null, outcome: null, finalAt: null, closedAt: null, k2: null,
  };
  settlement.acceptCaseDeposit(c, ctx.deposit, fixed.storageBytes);
  store.takeCaseId();
  for (const [slot, v] of Object.entries(fixed.blobs)) store.putBlob(fixing.blobKey(id, slot), v);
  store.putCase(id, c);
  store.log(`case ${id} created: ${pinnedTpl.id}@${pinnedTpl.version}, amount ${c.amount}`);
  return id;
}

function submit(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'AwaitingSubmission', 'submit');
  if (ctx.caller !== c.submitter) fail('E_NOT_SUBMITTER', 'only the named submitter may submit');
  deadlines.requireBefore(ctx.now, deadlines.submitDeadline(c), 'submission');
  const fixed = fixing.fixSubmission(args, c.clerk.lSub);
  c.submission = { ...fixed.record, at: ctx.now };
  settlement.acceptSubmitDeposit(c, ctx.deposit, fixed.storageBytes);
  for (const [slot, v] of Object.entries(fixed.blobs)) store.putBlob(fixing.blobKey(c.id, slot), v);
  c.phase = 'AwaitingDecision';
  store.putCase(c.id, c);
}

function post_decision(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'AwaitingDecision', 'post a decision');
  judgment.requireClerkCaller(c, ctx.caller);
  deadlines.requireBefore(ctx.now, deadlines.decisionDeadline(c), 'decision');
  const p = judgment.parsePrimaryPosting(args);
  settlement.acceptPostingStorage(c, ctx.deposit, p.storageBytes);
  c.decision = { verdict: p.verdict, usage: p.usage, at: ctx.now };
  store.putBlob(fixing.blobKey(c.id, 'response'), p.response);
  settlement.settlePrimaryFee(store, c, p.usage);
  c.phase = 'Decided';
  store.putCase(c.id, c);
  store.log(`case ${c.id} decided ${p.verdict}`);
}

function appeal_(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'Decided', 'appeal');
  appeal.requireAppellant(c, ctx.caller);
  deadlines.requireBefore(ctx.now, deadlines.appealDeadline(c), 'appeal');
  c.appeal = { by: ctx.caller, respondent: appeal.respondentOf(c), at: ctx.now, bond: null, fee: null, respondentBond: null, respondedAt: null, decision: null };
  settlement.acceptAppealDeposit(c, ctx.deposit);
  c.phase = 'Appealed';
  store.putCase(c.id, c);
}

function respond(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'Appealed', 'respond');
  appeal.requireRespondent(c, ctx.caller);
  deadlines.requireBefore(ctx.now, deadlines.respondDeadline(c), 'response');
  settlement.acceptRespondDeposit(c, ctx.deposit);
  c.appeal.respondedAt = ctx.now; // review starts
  c.phase = 'UnderReview';
  store.putCase(c.id, c);
}

function post_appeal_decision(store, ctx, args) {
  noK2(args);
  const c = loadCase(store, args.case_id);
  requirePhase(c, 'UnderReview', 'post an appeal decision');
  judgment.requireClerkCaller(c, ctx.caller);
  deadlines.requireBefore(ctx.now, deadlines.reviewDeadline(c), 'review');
  const p = appeal.parseAppealPosting(args);
  settlement.acceptPostingStorage(c, ctx.deposit, p.storageBytes);
  c.appeal.decision = { result: p.result, usage: p.usage, at: ctx.now };
  store.putBlob(fixing.blobKey(c.id, 'record'), p.record);
  settlement.settleAppealFee(store, c, p.usage);
  c.phase = 'Reviewed';
  store.putCase(c.id, c);
  store.log(`case ${c.id} appeal decided ${p.result}`);
}

// The closing transition of the case (§5.1 expiry rows and final rows).
// Returns null when nothing can close yet.
export function closingTransition(c, now) {
  const exp = deadlines.preJudgmentExpiry(c, now);
  if (exp === 'UNSUBMITTED') return { ending: 'UNSUBMITTED', outcome: null, finalAt: null, plan: { priceTo: 'R', refundFee1: false, appeal: 'none' } };
  if (exp === 'NO_DECISION') return { ending: 'NO_DECISION', outcome: null, finalAt: null, plan: { priceTo: 'R', refundFee1: true, appeal: 'none' } };
  const fin = deadlines.finality(c, now);
  if (!fin) return null;
  const appealEnd = appeal.appealEnding(c, fin);
  let priceTo = 'R', ending = fin.outcome;
  if (fin.outcome === 'PASS' && BigInt(c.amount) > 0n) {
    if (deadlines.releaseOpen(c, fin, now)) { priceTo = 'S'; ending = 'PASS_RELEASED'; }
    else ending = 'PASS_UNRELEASED';
  }
  return { ending, outcome: fin.outcome, finalAt: fin.finalAt, mode: fin.mode, plan: { priceTo, refundFee1: false, appeal: appealEnd } };
}

function finalize(store, ctx, args) {
  settlement.requireNoDeposit(ctx.deposit);
  const c = loadCase(store, args.case_id);
  const t = c.phase === 'Closed' ? null : closingTransition(c, ctx.now);
  if (!t) {
    noK2(args); // a finalize that cannot run pays nobody: k2 is rejected first
    fail(c.phase === 'Closed' ? 'E_CLOSED' : 'E_NOT_FINAL', c.phase === 'Closed' ? 'case already closed' : 'nothing to finalize yet');
  }
  settlement.closeCase(store, c, t.plan, args, ctx.sha256);
  c.phase = 'Closed';
  c.ending = t.ending; c.outcome = t.outcome; c.finalAt = t.finalAt; c.closedAt = ctx.now;
  store.putCase(c.id, c);
  store.log(`case ${c.id} closed: ${t.ending}`);
  return t.ending;
}

function withdraw(store, ctx, args) {
  noK2(args); settlement.requireNoDeposit(ctx.deposit);
  const amount = settlement.withdraw(store, ctx.caller, args.amount);
  return { transfer: { to: ctx.caller, amount } };
}

function quote_fee(store, _ctx, args) {
  const c = loadCase(store, args.case_id);
  const subLen = intArg(args.sub_len, 'sub_len', 0);
  return settlement.quoteFee(c, args.kind, subLen).toString();
}

// The 13 methods of §5.5. `payable` mirrors the near-sdk-js decorator.
export const METHODS = {
  register_key:         { kind: 'call', payable: false, fn: register_key },
  register_clerk:       { kind: 'call', payable: false, fn: register_clerk },
  register_signer:      { kind: 'call', payable: false, fn: register_signer },
  register_template:    { kind: 'call', payable: true,  fn: register_template },
  create_case:          { kind: 'call', payable: true,  fn: create_case },
  submit:               { kind: 'call', payable: true,  fn: submit },
  post_decision:        { kind: 'call', payable: true,  fn: post_decision },
  appeal:               { kind: 'call', payable: true,  fn: appeal_ },
  respond:              { kind: 'call', payable: true,  fn: respond },
  post_appeal_decision: { kind: 'call', payable: true,  fn: post_appeal_decision },
  finalize:             { kind: 'call', payable: false, fn: finalize },
  withdraw:             { kind: 'call', payable: false, fn: withdraw },
  quote_fee:            { kind: 'view', payable: false, fn: quote_fee },
};

export function dispatch(store, ctx, method, args) {
  const m = METHODS[method];
  if (!m) fail('E_NO_METHOD', method);
  return m.fn(store, ctx, args || {});
}

// ------------------------------------------------- read-only state access
// Not protocol methods: plain getters a client needs to read the record.

export const READERS = {
  get_case: (store, a) => loadCase(store, a.case_id),
  get_material: (store, a) => {
    loadCase(store, a.case_id);
    const v = store.getBlob(fixing.blobKey(a.case_id, a.slot));
    return v === null || v === undefined ? null : v;
  },
  next_case_id: (store) => store.peekCaseId(),
  get_clerk: (store, a) => store.getClerk(a.account) || null,
  get_template: (store, a) => store.getTemplate(registry.templateKey(a.clerk, a.template_id, a.version)) || null,
  get_template_count: (store, a) => store.getTemplateCount(a.clerk, a.template_id),
  get_key: (store, a) => store.getKey(a.account) || null,
  get_signers: (store) => store.getSigners(),
  get_balance: (store, a) => store.getBalance(a.account).toString(),
  get_owner: (store) => store.getOwner(),
};
