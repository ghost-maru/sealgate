// Exhaustive state-space check of the Sealgate profile (SPEC
//).
//
// Reviews sample paths; this checker instead enumerates the reachable
// states of contract/machine.mjs — the contract's own kernel code — for one
// case under adversarial action orderings and timings, across three regimes
// (inspection with a price, inspection at price 0, adjudication at price 0),
// and asserts on EVERY reached state and EVERY successful transition:
//
//   G1 global accounting: total deposits taken in == internal balances
//      + withdrawals executed + funds still held by open cases
//      (money.in - money.out) + retained storage/record fees, where the
//      retained part is computed independently from the deposits and the
//      kernel's own quote_fee view.
//   G2 fee conservation (§6.1): a posted fee has deposit == charge + refund,
//      charge <= deposit (the cap binds, never exceeded), and the charge
//      equals settlement.chargePrimaryOf / chargeAppealOf recomputed from
//      the pinned clerk registration, the on-chain lengths and the declared
//      usage.
//   G3 the k2 single rule (§5.4): a finalize carrying k2 succeeds only when
//      the case closes PASS_RELEASED; a closed case carries k2 on chain iff
//      its ending is PASS_RELEASED.
//   G4 price routing at close: on the closing transition of a PASS_RELEASED
//      case the submitter's balance grows by at least the price and the
//      requester's does not; on FAIL / NO_DECISION / PASS_UNRELEASED /
//      UNSUBMITTED closes the requester recovers the price and the
//      submitter does not gain it.
//   G5 deposit exactness: create / submit / appeal / postings with the
//      deposit one yocto off always throw, as do wrong-actor calls,
//      duplicate postings, late postings and any call on a Closed case.
//   G6 the time split (§5.3): for a final PASS with a price, finalize with
//      k2 succeeds iff now <= finalAt + W/2 (finality reached), and the
//      k2-less finalize closes it only after that instant.
//
// Coverage is asserted, not assumed: each regime must reach the endings and
// finality modes its shape allows, or the run fails.
//
// Scope honesty: this proves the invariants for the reference machine (the
// kernel code the contract wrapper also runs) over the bounded action set
// below. Response/record blobs are opaque to the kernel, so dummy blobs of
// the exact padded sizes stand in for them; signatures and the AI layer are
// checked elsewhere (§9 verify, clerk tests). It does not prove the
// near-sdk-js wrapper's storage layout, which the unit tests and the
// testnet stage cover.

import { Machine, settlement, fixing, deadlines } from '../contract/machine.mjs';
import { RECORD_FEE } from '../contract/src/kernel/params.js';
import { buildCriteria, buildSubmission, fromB64, toHex, utf8 } from '../shared/seal.mjs';
import { keypair } from '../shared/seal.mjs';
import { REGISTRATION } from '../clerk/config.mjs';
import { TEMPLATES } from '../clerk/templates.mjs';
import { clerkArgs, templateDeposit } from '../clerk/register.mjs';

const OWNER = 'owner.testnet', CLERK = 'clerk.testnet', FEES = 'fees.testnet', R = 'alice.testnet', S = 'bob.testnet', STRANGER = 'eve.testnet';
const CONTRACT = 'sealgate7.testnet';
const T0 = 1_700_000_000_000;
const NEAR = 10n ** 24n;
const U = { in: 1024, out: 1024 };
const U_BIG = { in: 102_400_000, out: 102_400_000 };
const RESP0 = Buffer.alloc(1048, 7).toString('base64'); // padded resp0 ciphertext size
const RESP1 = Buffer.alloc(8232, 9).toString('base64'); // padded resp1 ciphertext size

const failures = [];
const fail = (msg, ctx) => { if (failures.length < 60) failures.push(`${msg} :: ${ctx}`); };

function setupMachine() {
  const m = new Machine({ owner: OWNER, contractId: CONTRACT });
  const keys = { clerk: keypair(), R: keypair(), S: keypair() };
  m.call('register_key', { caller: R, now: T0 }, { pubkey: toHex(keys.R.pk) });
  m.call('register_key', { caller: S, now: T0 }, { pubkey: toHex(keys.S.pk) });
  m.call('register_signer', { caller: OWNER, now: T0 }, { algo: 'mock', address: 'ab'.repeat(20) });
  const args = clerkArgs({ account: CLERK, sealKeyHex: toHex(keys.clerk.pk), feeAccount: FEES, registration: REGISTRATION });
  m.call('register_clerk', { caller: OWNER, now: T0 }, args);
  for (const t of TEMPLATES) {
    m.call('register_template', { caller: CLERK, now: T0, deposit: templateDeposit(t) },
      { template_id: t.template_id, body: t.body, constraints: t.declarations.constraints, required_inputs: t.declarations.required_inputs });
  }
  return { m, keys };
}

const cloneSnap = (snap) => {
  const maps = {};
  for (const k of Object.keys(snap.maps)) maps[k] = new Map(snap.maps[k]);
  return { owner: snap.owner, nextCaseId: snap.nextCaseId, signers: snap.signers, maps };
};

function heldOf(c) {
  if (!c || c.phase === 'Closed') return 0n;
  return BigInt(c.money.in) - BigInt(c.money.out);
}

function checkGlobal(m, node, ctx) {
  let balances = 0n;
  for (const v of m.state.maps.balances.values()) balances += BigInt(v);
  let transfers = 0n;
  for (const t of m.transfers) transfers += BigInt(t.amount);
  const c = m.getCase(0);
  const held = heldOf(c);
  const total = balances + transfers + held + node.retained;
  if (total !== node.totalIn) fail(`G1 accounting: in ${node.totalIn} != balances ${balances} + transfers ${transfers} + held ${held} + retained ${node.retained}`, ctx);
}

function checkFees(m, ctx) {
  const c = m.getCase(0);
  if (!c) return;
  const lens = { crit: c.criteria.ctLen, sub: c.submission ? c.submission.ctLen : 0, tpl: c.template.bodyLen };
  if (c.decision) {
    const f = c.fee1;
    if (BigInt(f.deposit) !== BigInt(f.charge) + BigInt(f.refund)) fail('G2 primary fee: deposit != charge + refund', ctx);
    const cap = settlement.capPrimaryOf(c.clerk, lens.crit, lens.sub, lens.tpl);
    if (BigInt(f.deposit) !== cap) fail('G2 primary fee: deposit != CAP_1', ctx);
    let expect = null;
    try { expect = settlement.chargePrimaryOf(c.clerk, cap, lens, c.decision.usage); } catch { /* kernel accepted what recompute rejects: also a failure */ }
    if (expect === null || expect !== BigInt(f.charge)) fail(`G2 primary charge: settled ${f.charge} != recomputed ${expect}`, ctx);
  }
  if (c.appeal && c.appeal.decision) {
    const f = c.appeal.fee;
    if (BigInt(f.deposit) !== BigInt(f.charge) + BigInt(f.refund)) fail('G2 appeal fee: deposit != charge + refund', ctx);
    const capA = settlement.capAppealOf(c.clerk, lens.crit, lens.sub, lens.tpl);
    if (BigInt(f.deposit) !== capA) fail('G2 appeal fee: deposit != CAP_A', ctx);
    let expect = null;
    try { expect = settlement.chargeAppealOf(c.clerk, capA, lens, c.appeal.decision.usage); } catch { /* see above */ }
    if (expect === null || expect !== BigInt(f.charge)) fail(`G2 appeal charge: settled ${f.charge} != recomputed ${expect}`, ctx);
  }
}

function deadlinesOf(c, now) {
  if (!c) return [];
  const ds = [c.submitDeadline];
  if (c.submission) ds.push(deadlines.decisionDeadline(c));
  if (c.decision) ds.push(deadlines.appealDeadline(c));
  if (c.appeal) ds.push(deadlines.respondDeadline(c));
  if (c.appeal && c.appeal.respondedAt) ds.push(deadlines.reviewDeadline(c));
  const fin = deadlines.finality(c, Number.MAX_SAFE_INTEGER);
  if (fin) { ds.push(fin.finalAt, fin.finalAt + c.wMs / 2); }
  return ds;
}

function timeVec(c, now) {
  return deadlinesOf(c, now).map((d) => (now < d ? -1 : now === d ? 0 : 1)).join(',');
}
function stateKey(m, now) {
  const c = m.getCase(0);
  const bals = [...m.state.maps.balances.entries()].sort().join(';');
  return `${JSON.stringify(c)}|${bals}|${timeVec(c, now)}`;
}

function runRegime(regime) {
  const { m, keys } = setupMachine();
  const criteriaText = regime.templateId === 'adjudication'
    ? utf8('# Case file\nTerms of service.\n\n## Zeroth decision\nListing suspended for spam. Grounds: section 4.')
    : utf8('# Acceptance criteria\nA market report on five competitors, including a price table.');
  const submissionText = utf8('# Deliverables\nReport on five competitors. Section 4: price table.');
  const mat = buildCriteria({ contract: CONTRACT, caseId: 0, criteria: criteriaText, submitterPk: keys.S.pk });
  const sub = buildSubmission({ contract: CONTRACT, caseId: 0, submission: submissionText, SK: mat.SK, clerkPk: keys.clerk.pk, requesterPk: keys.R.pk });
  const K2_HEX = toHex(sub.K2);
  const WRONG_K2 = toHex(new Uint8Array(32).fill(3));

  const createArgs = {
    clerk: CLERK, template_id: regime.templateId, template_version: 1, submitter: S,
    amount: regime.amount.toString(), criteria_hash: mat.criteria_hash, criteria_ct: mat.criteria_ct, env_s: mat.env_s,
    submit_window_sec: 86400, w_sec: 3600, expected_case_id: 0,
  };
  const createFixed = fixing.fixCriteria(createArgs, REGISTRATION.l_crit);
  const createDeposit = regime.amount + RECORD_FEE + settlement.storageFee(createFixed.storageBytes);
  const createRetained = createDeposit - regime.amount;
  const submitArgs = { case_id: 0, sub_hash: sub.sub_hash, sub_ct: sub.sub_ct, env_c: sub.env_c, env_r: sub.env_r, lock: sub.lock };
  const subLen = fromB64(sub.sub_ct).length;

  const start = { snap: m.snapshot(), now: T0, totalIn: 0n, retained: 0n, transfers: [] };
  const seen = new Map([[stateKey(m, T0), true]]);
  const queue = [start];
  const endings = {}, modes = {};
  let states = 0, transitions = 0, k2SuccessOutsideRelease = 0;

  const restore = (node) => { m.state = cloneSnap(node.snap); m.transfers = [...node.transfers]; };
  const balancesOf = () => { const o = {}; for (const [k, v] of m.state.maps.balances) o[k] = BigInt(v); return o; };

  // One attempted call. Returns the child node on success, null on throw.
  // Invariants that must hold for THIS attempt are checked here.
  function attempt(node, label, method, callCtx, args, { escrowIn = 0n, retainedAdd = 0n } = {}) {
    restore(node);
    const path = `${regime.name} ${label}`;
    const preCase = method === 'finalize' ? m.getCase(0) : null;
    const finPre = preCase && preCase.phase !== 'Closed' ? deadlines.finality(preCase, callCtx.now) : null;
    let out;
    try {
      out = m.call(method, callCtx, args);
    } catch (e) {
      return null; // refused: the machine rolled back; nothing to check
    }
    transitions++;
    const child = {
      snap: m.snapshot(), now: callCtx.now,
      totalIn: node.totalIn + (callCtx.deposit || 0n),
      retained: node.retained + retainedAdd,
      transfers: [...m.transfers],
    };
    if (method === 'finalize') {
      const c = m.getCase(0);
      if (args.k2 !== undefined) {
        if (c.ending !== 'PASS_RELEASED') { k2SuccessOutsideRelease++; fail(`G3 k2 accepted but ending is ${c.ending}`, path); }
        if (c.k2 !== args.k2) fail('G3 k2 on chain differs from the k2 sent', path);
      }
      // G6: the time split, both directions.
      if (finPre && finPre.outcome === 'PASS' && BigInt(c.amount) > 0n) {
        const rd = finPre.finalAt + c.wMs / 2;
        if (args.k2 !== undefined && callCtx.now > rd) fail(`G6 k2 accepted after the release deadline (${callCtx.now} > ${rd})`, path);
        if (args.k2 === undefined && c.ending === 'PASS_UNRELEASED' && callCtx.now <= rd) fail(`G6 closed PASS_UNRELEASED inside the release window (${callCtx.now} <= ${rd})`, path);
      }
    }
    checkFees(m, path);
    checkGlobal(m, child, path);
    const key = stateKey(m, callCtx.now);
    if (!seen.has(key)) { seen.set(key, true); queue.push(child); }
    return child;
  }

  // finalize attempts carry balance-delta checks (G4), so they are not plain attempts.
  function attemptFinalize(node, label, args, now) {
    restore(node);
    const before = balancesOf();
    const pre = m.getCase(0);
    const finPre = pre && pre.phase !== 'Closed' ? deadlines.finality(pre, now) : null;
    const child = attempt(node, label, 'finalize', { caller: args._caller || R, deposit: 0n, now }, args);
    if (!child) return null;
    const c = m.getCase(0);
    endings[c.ending] = (endings[c.ending] || 0) + 1;
    if (finPre && c.phase === 'Closed') modes[finPre.mode] = (modes[finPre.mode] || 0) + 1;
    const after = balancesOf();
    const dR = (after[R] || 0n) - (before[R] || 0n);
    const dS = (after[S] || 0n) - (before[S] || 0n);
    const amount = BigInt(c.amount);
    if (amount > 0n) {
      if (c.ending === 'PASS_RELEASED' && !(dS >= amount && dR < amount)) fail(`G4 PASS_RELEASED routing: dS ${dS}, dR ${dR}, amount ${amount}`, `${regime.name} ${label}`);
      if (['FAIL', 'NO_DECISION', 'PASS_UNRELEASED', 'UNSUBMITTED'].includes(c.ending) && !(dR >= amount && dS < amount)) fail(`G4 ${c.ending} routing: dR ${dR}, dS ${dS}, amount ${amount}`, `${regime.name} ${label}`);
    }
    return child;
  }

  while (queue.length) {
    const node = queue.shift();
    states++;
    if (states > 400_000) { fail('state cap exceeded', regime.name); break; }
    restore(node);
    const c = m.getCase(0);
    const now = node.now;
    const acts = [];
    const A = (label, fn) => acts.push([label, fn]);

    if (!c) {
      A('create', () => attempt(node, 'create', 'create_case', { caller: R, deposit: createDeposit, now }, createArgs, { escrowIn: regime.amount, retainedAdd: createRetained }));
      A('create-1yocto', () => attempt(node, 'create deposit -1', 'create_case', { caller: R, deposit: createDeposit - 1n, now }, createArgs));
      A('create+1yocto', () => attempt(node, 'create deposit +1', 'create_case', { caller: R, deposit: createDeposit + 1n, now }, createArgs));
      if (regime.templateId === 'adjudication') {
        A('create-with-price', () => attempt(node, 'adjudication with price', 'create_case', { caller: R, deposit: createDeposit + NEAR, now }, { ...createArgs, amount: (1n).toString() }));
      }
    } else if (c.phase !== 'Closed') {
      const cap1 = c.phase === 'AwaitingSubmission' ? BigInt(m.view('quote_fee', { case_id: 0, kind: 'primary', sub_len: subLen })) : 0n;
      const submitFixed = c.phase === 'AwaitingSubmission' ? fixing.fixSubmission(submitArgs, c.clerk.lSub) : null;
      const submitDeposit = c.phase === 'AwaitingSubmission' ? cap1 + settlement.storageFee(submitFixed.storageBytes) : 0n;
      if (c.phase === 'AwaitingSubmission') {
        A('submit', () => attempt(node, 'submit', 'submit', { caller: S, deposit: submitDeposit, now }, submitArgs, { escrowIn: cap1, retainedAdd: submitDeposit - cap1 }));
        A('submit-1yocto', () => attempt(node, 'submit deposit -1', 'submit', { caller: S, deposit: submitDeposit - 1n, now }, submitArgs));
        A('submit-by-R', () => attempt(node, 'submit by R', 'submit', { caller: R, deposit: submitDeposit, now }, submitArgs));
        A('submit-late', () => attempt(node, 'submit after deadline', 'submit', { caller: S, deposit: submitDeposit, now: c.submitDeadline + 1 }, submitArgs));
        A('post-too-early', () => attempt(node, 'post_decision before submit', 'post_decision', { caller: CLERK, deposit: settlement.storageFee(1048), now }, { case_id: 0, verdict: 'PASS', response: RESP0, usage: [U] }));
      }
      if (c.phase === 'AwaitingDecision') {
        const postDeposit = settlement.storageFee(1048);
        for (const [vname, verdict, usage] of [['PASS/u1', 'PASS', [U]], ['FAIL/u1', 'FAIL', [U]], ['PASS/formal', 'PASS', []], ['FAIL/formal', 'FAIL', []], ['PASS/overcap', 'PASS', [U_BIG]]]) {
          A(`post-${vname}`, () => attempt(node, `post_decision ${vname}`, 'post_decision', { caller: CLERK, deposit: postDeposit, now }, { case_id: 0, verdict, response: RESP0, usage }, { retainedAdd: postDeposit }));
        }
        A('post-by-R', () => attempt(node, 'post_decision by R', 'post_decision', { caller: R, deposit: postDeposit, now }, { case_id: 0, verdict: 'PASS', response: RESP0, usage: [U] }));
        A('post-1yocto', () => attempt(node, 'post_decision deposit -1', 'post_decision', { caller: CLERK, deposit: postDeposit - 1n, now }, { case_id: 0, verdict: 'PASS', response: RESP0, usage: [U] }));
        A('post-late', () => attempt(node, 'post_decision after W1', 'post_decision', { caller: CLERK, deposit: postDeposit, now: deadlines.decisionDeadline(c) + 1 }, { case_id: 0, verdict: 'PASS', response: RESP0, usage: [U] }));
        A('submit-again', () => attempt(node, 'submit twice', 'submit', { caller: S, deposit: 0n, now }, submitArgs));
      }
      if (c.phase === 'Decided') {
        const loser = c.decision.verdict === 'PASS' ? R : S;
        const winner = c.decision.verdict === 'PASS' ? S : R;
        const capA = BigInt(m.view('quote_fee', { case_id: 0, kind: 'appeal', sub_len: c.submission.ctLen }));
        const appealDeposit = BigInt(c.bond) + capA;
        A('appeal', () => attempt(node, 'appeal', 'appeal', { caller: loser, deposit: appealDeposit, now }, { case_id: 0 }, { escrowIn: appealDeposit }));
        A('appeal-by-winner', () => attempt(node, 'appeal by winner', 'appeal', { caller: winner, deposit: appealDeposit, now }, { case_id: 0 }));
        A('appeal-1yocto', () => attempt(node, 'appeal deposit -1', 'appeal', { caller: loser, deposit: appealDeposit - 1n, now }, { case_id: 0 }));
        A('appeal-late', () => attempt(node, 'appeal after window', 'appeal', { caller: loser, deposit: appealDeposit, now: deadlines.appealDeadline(c) + 1 }, { case_id: 0 }));
        A('post-again', () => attempt(node, 'post_decision twice', 'post_decision', { caller: CLERK, deposit: settlement.storageFee(1048), now }, { case_id: 0, verdict: 'FAIL', response: RESP0, usage: [U] }));
      }
      if (c.phase === 'Appealed') {
        A('respond', () => attempt(node, 'respond', 'respond', { caller: c.appeal.respondent, deposit: BigInt(c.bond), now }, { case_id: 0 }, { escrowIn: BigInt(c.bond) }));
        A('respond-by-appellant', () => attempt(node, 'respond by appellant', 'respond', { caller: c.appeal.by, deposit: BigInt(c.bond), now }, { case_id: 0 }));
        A('respond-late', () => attempt(node, 'respond after window', 'respond', { caller: c.appeal.respondent, deposit: BigInt(c.bond), now: deadlines.respondDeadline(c) + 1 }, { case_id: 0 }));
      }
      if (c.phase === 'UnderReview') {
        const postDeposit = settlement.storageFee(8232);
        const flip = c.decision.verdict === 'PASS' ? 'FAIL' : 'PASS';
        for (const [vname, result, usage] of [
          ['flip/full', flip, { panel: [U, U, U], comparison: [U] }],
          ['same/full', c.decision.verdict, { panel: [U, U, U], comparison: [U] }],
          ['same/no-comparison', c.decision.verdict, { panel: [U, U, U], comparison: [] }],
          ['flip/formal', flip, { panel: [], comparison: [] }],
          ['flip/partial-panel', flip, { panel: [U, U], comparison: [] }],
        ]) {
          A(`appeal-post-${vname}`, () => attempt(node, `post_appeal_decision ${vname}`, 'post_appeal_decision', { caller: CLERK, deposit: postDeposit, now }, { case_id: 0, result, record: RESP1, usage }, { retainedAdd: postDeposit }));
        }
        A('appeal-post-by-R', () => attempt(node, 'post_appeal_decision by R', 'post_appeal_decision', { caller: R, deposit: postDeposit, now }, { case_id: 0, result: flip, record: RESP1, usage: { panel: [U, U, U], comparison: [U] } }));
        A('appeal-post-late', () => attempt(node, 'post_appeal_decision after W1', 'post_appeal_decision', { caller: CLERK, deposit: postDeposit, now: deadlines.reviewDeadline(c) + 1 }, { case_id: 0, result: flip, record: RESP1, usage: { panel: [U, U, U], comparison: [U] } }));
      }
      // finalize at every relevant time, with and without k2
      const times = new Set([now]);
      for (const d of deadlinesOf(c, now)) { if (d >= now) { times.add(d); times.add(d + 1); if (d - 1 >= now) times.add(d - 1); } }
      for (const t of [...times].sort((a, b) => a - b)) {
        A(`finalize-nok2@${t}`, () => attemptFinalize(node, `finalize no k2 @${t}`, { case_id: 0, _caller: STRANGER }, t));
        A(`finalize-k2@${t}`, () => attemptFinalize(node, `finalize k2 @${t}`, { case_id: 0, k2: K2_HEX, _caller: S }, t));
        A(`finalize-wrongk2@${t}`, () => attemptFinalize(node, `finalize wrong k2 @${t}`, { case_id: 0, k2: WRONG_K2, _caller: S }, t));
      }
    } else {
      // Closed: every case call must throw (G5); withdraw still works.
      A('closed-submit', () => attempt(node, 'submit on closed', 'submit', { caller: S, deposit: 0n, now }, submitArgs));
      A('closed-finalize', () => attemptFinalize(node, 'finalize on closed', { case_id: 0, _caller: R }, now));
      A('closed-finalize-k2', () => attemptFinalize(node, 'finalize k2 on closed', { case_id: 0, k2: K2_HEX, _caller: S }, now));
    }
    // withdraw: any account holding a balance, in full
    restore(node);
    for (const [acct, bal] of m.state.maps.balances) {
      if (BigInt(bal) > 0n) {
        const b = BigInt(bal);
        A(`withdraw-${acct}`, () => attempt(node, `withdraw ${acct}`, 'withdraw', { caller: acct, deposit: 0n, now }, { amount: b.toString() }));
      }
    }
    for (const [, fn] of acts) fn();
  }

  return { name: regime.name, states, transitions, endings, modes };
}

const regimes = [
  { name: 'A inspection 5 NEAR', templateId: 'inspection', amount: 5n * NEAR, wantEndings: ['UNSUBMITTED', 'NO_DECISION', 'PASS_RELEASED', 'PASS_UNRELEASED', 'FAIL'], wantModes: ['no_appeal', 'default', 'appeal_decision', 'clerk_silence'] },
  { name: 'B adjudication 0', templateId: 'adjudication', amount: 0n, wantEndings: ['UNSUBMITTED', 'NO_DECISION', 'PASS', 'FAIL'], wantModes: ['no_appeal', 'default', 'appeal_decision', 'clerk_silence'] },
  { name: 'C inspection 0', templateId: 'inspection', amount: 0n, wantEndings: ['UNSUBMITTED', 'NO_DECISION', 'PASS', 'FAIL'], wantModes: ['no_appeal', 'default', 'appeal_decision', 'clerk_silence'] },
];

let totalStates = 0;
for (const regime of regimes) {
  const r = runRegime(regime);
  totalStates += r.states;
  console.log(`\n== regime ${r.name}: ${r.states} states, ${r.transitions} successful transitions`);
  console.log(`   endings: ${JSON.stringify(r.endings)}`);
  console.log(`   finality modes: ${JSON.stringify(r.modes)}`);
  for (const e of regime.wantEndings) if (!r.endings[e]) fail(`coverage: ending ${e} never reached`, regime.name);
  for (const md of regime.wantModes) if (!r.modes[md]) fail(`coverage: finality mode ${md} never reached`, regime.name);
}
console.log(`\ntotal states explored: ${totalStates}`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('all invariants held on every explored state');
