// Exhaustive state-space check of the Sealgate state machine.
//
// Reviews (human/LLM) sample attack paths; this checker instead enumerates
// ALL reachable states of contract/machine.mjs under adversarial action
// orderings — both parties, the executor, valid and invalid amounts, and
// times on both sides of every window boundary — and asserts the money
// invariants on EVERY settlement plan it encounters:
//
//   I1 conservation: total paid out == escrow amount + all bonds posted.
//   I2 the escrow amount is paid exactly once, in full, to one destination.
//   I3 the executor never receives escrow or bond funds (the appeal fee is
//      the single, separately-checked exception: M8 routing, asserted in
//      checkPlan — executor on a posted L1, refunded otherwise).
//   I4 bond PnL per outcome class: decided appeal -> winner +2*B0, loser
//      -2*B0; plain claim -> claimant net 0; lapsed appeal -> both net 0;
//      default overturn -> appellant +B0, claimant -B0.
//   I5 nobody receives bond funds they did not post (except the I4 winners,
//      whose receipts are exactly their own postings + the loser's 2*B0).
//   I6 once Final, every further action throws.
//   I9 storage (v5): on every Final state, pruning eventually executes
//      (both-party consent, or the retention delay), refunds exactly the
//      storage payments minus the retained record rent, to their payers,
//      and cannot run twice. (Claim response charges are exercised at
//      responseBytes 0 in this action set; per-byte exactness at nonzero
//      sizes is unit-tested in test/machine.test.mjs.)
//
// Scope honesty: this proves the invariants for the REFERENCE MACHINE over
// the bounded action set below, across legacy and v4 parameter regimes.
// Following the v4 design review (S8), the checker enumerates deadline
// ORDERINGS per escrow (its terms come from termsOf) rather than sweeping
// absolute parameter values, and states the money invariants parametrically
// in B0. It does not prove the near-sdk-js port identical
// (covered by unit tests + scripts/reproduce.mjs against the live contract),
// and it says nothing about the AI/TEE layer or off-chain actors' honesty.
import { NEAR, MIN_BOND, W, W1, createEscrow, submitDeliverable, postClaim, dispute, respondDispute, coSign, finalizeClaim, expire, bond0, registerKey, ackBundle, claimJob, feeOf, termsOf, bondOf, feeOfTerms, defaultTerms, APPEAL_FEE, CREATE_STORAGE, RECORD_RENT, PRUNE_DELAY_MS, storageChargeFor, prune } from '../contract/machine.mjs';

const B0of = (st) => bondOf(termsOf(st), st.amount);
const Wof = (st) => termsOf(st).wMs;
const W1of = (st) => termsOf(st).w1Ms;

const BUYER = 'buyer.near'; const WORKER = 'worker.near'; const EXEC = 'executor.near'; const SINK = 'sink.near';
const T0 = 1_000_000_000;
let hashCounter = 0;
const freshHash = () => String(++hashCounter).padStart(64, '0');

let statesSeen = 0; let settlements = 0; const failures = []; const classCount = {};
const fail = (msg, ctx) => failures.push(`${msg} :: ${ctx}`);

function postedBy(s) {
  // Bond postings only. The appeal fee is tracked separately (it is not a
  // bond: it pays the executor on a posted L1 and is refunded otherwise).
  const p = { [BUYER]: 0n, [WORKER]: 0n, [EXEC]: 0n };
  for (const c of s.claims) p[c.by] += c.bond;
  if (s.dispute) { p[s.dispute.by] += s.dispute.bond; p[s.claims[0].by] += s.dispute.respondentBond; }
  return p;
}

function checkPlan(s, plan, kind, ctx) {
  settlements++;
  const cls = kind === 'expire' ? 'expire' : s.claims.length > 1 ? 'decided' : s.dispute ? (s.dispute.funded ? (s.dispute.acked ? 'lapsed-acked' : 'lapsed-unacked') : 'default') : 'plain';
  classCount[cls] = (classCount[cls] || 0) + 1;
  const posted = postedBy(s);
  const appealFee = s.dispute?.appealFee ?? 0n;
  const totalPosted = s.amount + posted[BUYER] + posted[WORKER] + posted[EXEC] + appealFee;
  const totalOut = plan.transfers.reduce((x, t) => x + t.amount, 0n);
  if (totalOut !== totalPosted) fail(`I1 conservation: out ${totalOut} != posted ${totalPosted}`, ctx);
  // The appeal fee's routing (M8): to the executor iff an L1 claim was
  // posted; refunded to the appellant on lapse/default; absent otherwise.
  const feeToExec = plan.transfers.filter((t) => t.kind === 'appeal-fee');
  const feeRefund = plan.transfers.filter((t) => t.kind === 'appeal-fee-refund');
  if (appealFee > 0n) {
    if (s.claims.length > 1) {
      if (feeToExec.length !== 1 || feeToExec[0].to !== EXEC || feeToExec[0].amount !== appealFee || feeRefund.length !== 0) fail('appeal fee not paid to the executor on a posted L1', ctx);
    } else if (s.dispute) {
      if (feeRefund.length !== 1 || feeRefund[0].to !== s.dispute.by || feeRefund[0].amount !== appealFee || feeToExec.length !== 0) fail('appeal fee not refunded to the appellant', ctx);
    } else if (feeToExec.length || feeRefund.length) fail('appeal fee moved with no dispute', ctx);
  } else if (feeToExec.length || feeRefund.length) fail('appeal fee moved on a no-fee (legacy) escrow', ctx);
  const escrowPays = plan.transfers.filter((t) => t.kind === 'escrow');
  const feePays = plan.transfers.filter((t) => t.kind === 'fee');
  if (escrowPays.length !== 1) fail('I2 escrow disbursed != once', ctx);
  if (kind === 'expire') {
    if (feePays.length !== 0 || escrowPays[0].amount !== s.amount) fail('I2 expire must refund in full with no fee', ctx);
  } else {
    const terms = termsOf(s);
    const wantFee = feeOfTerms(terms, s.amount);
    if (escrowPays[0].amount + (feePays[0]?.amount ?? 0n) !== s.amount) fail('I2 escrow + fee != amount in full', ctx);
    if (wantFee > 0n && (feePays.length !== 1 || feePays[0].to !== terms.feeSink || feePays[0].amount !== wantFee)) fail('I2 fee missing, misdirected, or wrong size', ctx);
    if (wantFee === 0n && feePays.length !== 0) fail('I2 unexpected fee transfer', ctx);
  }
  const got = { [BUYER]: 0n, [WORKER]: 0n, [EXEC]: 0n };
  for (const t of plan.transfers) if (t.kind !== 'escrow' && t.kind !== 'fee' && t.kind !== 'appeal-fee' && t.kind !== 'appeal-fee-refund') got[t.to] += t.amount;
  if (got[EXEC] !== 0n) fail('I3 executor received escrow or bond funds (only the appeal fee may reach it)', ctx);
  const B0 = B0of(s);
  const net = (p) => got[p] - posted[p];
  const l1 = s.claims.length > 1 ? s.claims[s.claims.length - 1] : null;
  if (kind === 'expire') {
    if (totalOut !== s.amount) fail('I1 expire pays more than the escrow', ctx);
    return;
  }
  if (l1) { // decided appeal
    const winner = plan.outcome === s.claims[0].verdict && !l1.integrityVoid ? s.claims[0].by : s.dispute.by;
    const loser = winner === s.claims[0].by ? s.dispute.by : s.claims[0].by;
    if (net(winner) !== 2n * B0 || net(loser) !== -2n * B0) fail(`I4 decided appeal: winner net ${net(winner)}, loser net ${net(loser)}, want +/-${2n * B0}`, ctx);
  } else if (s.dispute && s.dispute.funded) { // lapsed appeal: attribution by ack (N3)
    if (s.dispute.acked) {
      if (net(BUYER) !== 0n || net(WORKER) !== 0n) fail(`I4 acked lapse moved bonds: buyer ${net(BUYER)}, worker ${net(WORKER)}`, ctx);
    } else if (net(s.dispute.by) !== -2n * B0 || net(s.claims[0].by) !== 2n * B0) {
      fail(`I4 unacked lapse: appellant net ${net(s.dispute.by)}, claimant net ${net(s.claims[0].by)}, want -/+${2n * B0}`, ctx);
    }
  } else if (s.dispute) { // default overturn (respondent never funded)
    if (net(s.dispute.by) !== B0 || net(s.claims[0].by) !== -B0) fail(`I4 default: appellant net ${net(s.dispute.by)}, claimant net ${net(s.claims[0].by)}, want +/-${B0}`, ctx);
  } else { // plain claim
    if (net(s.claims[0].by) !== 0n) fail('I4 plain claim: claimant bond not fully returned', ctx);
  }
  for (const p of [BUYER, WORKER]) {
    if (got[p] > 0n && posted[p] === 0n) fail(`I5 ${p} received bond funds without posting`, ctx);
  }
}

function actions(s, reg) {
  const out = [];
  const at = s.claims[0]?.at;
  const push = (name, fn, settleKind = null) => out.push({ name, fn, settleKind });
  if (s.phase === 'Funded' && s.open && !s.worker) {
    push('claim by worker', (st, rg) => claimJob(st, { by: WORKER, now: s.claimBy - 1 }));
    push('claim by buyer (must throw)', (st, rg) => claimJob(st, { by: BUYER, now: s.claimBy - 1 }));
    push('claim by executor (must throw)', (st, rg) => claimJob(st, { by: EXEC, now: s.claimBy - 1 }));
    push('claim after deadline (must throw)', (st, rg) => claimJob(st, { by: WORKER, now: s.claimBy + 1 }));
    push('expire unclaimed', (st, rg) => expire(st, { now: s.claimBy + 1 }), 'expire');
  }
  if (s.phase === 'Funded' && s.worker && !s.workerKey) {
    push('register worker key', (st, rg) => registerKey(st, { by: WORKER, pubkey: 'b'.repeat(64) }));
  }
  if (s.phase === 'Funded') {
    for (const now of [s.deliverBy - 1, s.deliverBy + 1]) push(`deliver@${now > s.deliverBy ? 'late' : 'intime'}`, (st, rg) => submitDeliverable(st, { by: WORKER, deliverableHash: 'd'.repeat(64), encryptedDeliverable: 'cipher', now, storagePaid: st.termsVersion === 2 ? storageChargeFor(6) : 0n }));
    push('expire@late', (st, rg) => expire(st, { now: s.settleBy + 1 }), 'expire');
  }
  if (s.phase === 'Delivered') {
    for (const by of [WORKER, BUYER]) for (const verdict of ['PASS', 'FAIL']) {
      push(`L0 ${verdict} by ${by === WORKER ? 'worker' : 'buyer'}`, (st, rg) => postClaim(st, { by, level: 0, verdict, reqHash: freshHash(), respHash: freshHash(), bondPaid: B0of(st), now: T0 + 2, executor: EXEC, escrowKey: 'X' }, rg));
      push(`L0 ${verdict} underpaid by ${by === WORKER ? 'worker' : 'buyer'}`, (st, rg) => postClaim(st, { by, level: 0, verdict, reqHash: freshHash(), respHash: freshHash(), bondPaid: B0of(st) - 1n, now: T0 + 2, executor: EXEC, escrowKey: 'X' }, rg));
    }
    push('expire@settleBy+1', (st, rg) => expire(st, { now: s.settleBy + 1 }), 'expire');
  }
  if (s.phase === 'Claimed' && s.claims.length === 1) {
    const claimant = s.claims[0].by; const other = claimant === WORKER ? BUYER : WORKER;
    for (const t of [at + 1, at + Wof(s) / 2, at + Wof(s) / 2 + 1]) push(`dispute@${t - at}`, (st, rg) => dispute(st, { by: other, groundsHash: 'e'.repeat(64), bondPaid: 2n * B0of(st), feePaid: termsOf(st).appealFee, now: t }));
    push('dispute by claimant (must throw)', (st, rg) => dispute(st, { by: claimant, groundsHash: 'e'.repeat(64), bondPaid: 2n * B0of(st), feePaid: termsOf(st).appealFee, now: at + 1 }));
    push('dispute without the appeal fee (must throw)', (st, rg) => dispute(st, { by: other, groundsHash: 'e'.repeat(64), bondPaid: 2n * B0of(st), feePaid: 0n, now: at + 1 }));
    for (const by of [BUYER, WORKER]) push(`co-sign ${by === WORKER ? 'worker' : 'buyer'}`, (st, rg) => coSign(st, { by }), 'plain');
    for (const t of [s.windowEnds, s.windowEnds + 1]) push(`finalize@${t - (at)}`, (st, rg) => finalizeClaim(st, { now: t }), 'plain');
  }
  if (s.phase === 'Disputed') {
    const claimant = s.claims[0].by;
    for (const t of [at + Wof(s), at + Wof(s) + 1]) push(`respond@${t - at}`, (st, rg) => respondDispute(st, { by: claimant, bondPaid: B0of(st), now: t }));
    push('party L1 attempt (must throw)', (st, rg) => postClaim(st, { by: claimant, level: 1, verdict: 'PASS', reqHash: freshHash(), respHash: freshHash(), bondPaid: 0n, now: at + 3, executor: EXEC, escrowKey: 'X' }, rg));
    if (s.dispute.acked) push('ack again past the deadline (I8: must not throw)', (st, rg) => { try { return ackBundle(st, { by: EXEC, now: (s.dispute.fundedAt || s.dispute.at) + W1of(st) }); } catch (e) { fail(`I8 repeat ack threw: ${e.message}`, 'repeat-ack'); throw e; } });
    if (s.dispute.funded) {
      for (const verdict of ['PASS', 'FAIL']) for (const iv of [false, true]) {
        push(`L1 ${verdict} void=${iv}`, (st, rg) => postClaim(st, { by: EXEC, level: 1, verdict, reqHash: freshHash(), respHash: freshHash(), bondPaid: 0n, integrityVoid: iv, now: s.dispute.fundedAt + 1, executor: EXEC, escrowKey: 'X' }, rg));
      }
      push('ack by executor', (st, rg) => ackBundle(st, { by: EXEC, now: s.dispute.fundedAt + 1 }));
      push('ack at the W1/2 boundary', (st, rg) => ackBundle(st, { by: EXEC, now: s.dispute.fundedAt + W1of(st) / 2 }));
      push('ack past the W1/2 deadline (must throw)', (st, rg) => ackBundle(st, { by: EXEC, now: s.dispute.fundedAt + W1of(st) / 2 + 1 }));
      push('ack by party (must throw)', (st, rg) => ackBundle(st, { by: BUYER, now: s.dispute.fundedAt + 1 }));
      push('finalize lapsed', (st, rg) => finalizeClaim(st, { now: s.dispute.fundedAt + W1of(st) + 1 }), 'lapsed');
    } else {
      push('ack pre-funding by executor', (st, rg) => ackBundle(st, { by: EXEC, now: s.dispute.at + 1 }));
      push('ack pre-funding by party (must throw)', (st, rg) => ackBundle(st, { by: BUYER, now: s.dispute.at + 1 }));
      push('finalize default', (st, rg) => finalizeClaim(st, { now: at + Wof(st) + 1 }), 'default');
    }
  }
  if (s.phase === 'Claimed' && s.claims.length === 2) {
    for (const by of [BUYER, WORKER]) push(`co-sign L1 ${by === WORKER ? 'worker' : 'buyer'}`, (st, rg) => coSign(st, { by }), 'decided');
    push('finalize L1 window', (st, rg) => finalizeClaim(st, { now: s.windowEnds + 1 }), 'decided');
  }
  return out;
}

function keyOf(s, reg) {
  return JSON.stringify({
    p: s.phase, w: s.worker, op: !!s.open, ct: s.caseType, dh: !!s.deliverableHash,
    c: s.claims.map((c) => [c.by, c.level, c.verdict, c.integrityVoid, String(c.bond), c.at - T0, c.coSignedBy]),
    d: s.dispute ? [s.dispute.by, String(s.dispute.bond), String(s.dispute.respondentBond), String(s.dispute.appealFee ?? 0n), s.dispute.funded, s.dispute.at - T0, s.dispute.fundedAt ? s.dispute.fundedAt - T0 : 0, !!s.dispute.acked, s.dispute.ackedAt ? s.dispute.ackedAt - T0 : 0] : null,
    we: s.windowEnds ? s.windowEnds - T0 : 0, o: s.outcome, df: !!s.defaulted, r: reg.size,
  });
}

function explore(amount, label, terms = null) {
  const B0 = terms ? bondOf(terms, amount) : bond0(amount);
  console.log(`--- regime: ${label} (amount ${amount}, B0 ${B0})`);
  const init = () => {
    const s = createEscrow({ buyer: BUYER, worker: WORKER, amount, criteriaHash: 'c'.repeat(64), deliverBy: T0 + 1000, settleBy: T0 + 100_000_000, executor: EXEC, executorKey: '9'.repeat(64), feeSink: SINK, terms, now: T0, storagePaid: terms ? CREATE_STORAGE : 0n });
    registerKey(s, { by: BUYER, pubkey: 'a'.repeat(64) });
    registerKey(s, { by: WORKER, pubkey: 'b'.repeat(64) });
    return { s, reg: new Set() };
  };
  const initOpen = () => {
    const s = createEscrow({ buyer: BUYER, open: true, amount, criteriaHash: 'c'.repeat(64), claimBy: T0 + 500, deliverWindow: 1000, settleWindow: 100_000_000, executor: EXEC, executorKey: '9'.repeat(64), feeSink: SINK, terms, now: T0, storagePaid: terms ? CREATE_STORAGE : 0n });
    registerKey(s, { by: BUYER, pubkey: 'a'.repeat(64) });
    return { s, reg: new Set() };
  };
  const start = init();
  const startOpen = initOpen();
  const seen = new Set([keyOf(start.s, start.reg), keyOf(startOpen.s, startOpen.reg)]);
  const queue = [start, startOpen];
  while (queue.length) {
    const { s, reg } = queue.pop();
    statesSeen++;
    if (s.dispute?.acked && s.dispute?.funded && s.dispute.ackedAt > s.dispute.fundedAt + W1of(s) / 2 && s.dispute.ackedAt > s.dispute.fundedAt) fail(`I7 ack recorded after the deadline: ackedAt ${s.dispute.ackedAt}, fundedAt ${s.dispute.fundedAt}`, keyOf(s, reg));
    if (s.phase === 'Final') {
      // I9: storage pruning on this Final state. Compute what was paid in
      // before any prune zeroes the fields.
      {
        const storageIn = (s.createStorage ?? 0n) + (s.deliverableStorage ?? 0n) + s.claims.reduce((x, c) => x + (c.storagePaid ?? 0n), 0n);
        const wantRetained = (s.createStorage ?? 0n) > 0n ? RECORD_RENT : 0n;
        const sp = structuredClone(s);
        let r = prune(sp, { by: BUYER, now: T0 + 900_000_000 });
        if (!r.executed && sp.worker) r = prune(sp, { by: WORKER, now: T0 + 900_000_000 });
        if (!r.executed) fail('I9 prune never executed on a Final escrow', `${label} :: ${keyOf(s, reg)}`);
        else {
          const refunded = r.transfers.reduce((x, t) => x + t.amount, 0n);
          if (r.transfers.some((t) => t.kind !== 'storage-refund')) fail('I9 prune moved non-storage funds', label);
          if (refunded + r.retained !== storageIn) fail(`I9 storage conservation: refunded ${refunded} + retained ${r.retained} != paid ${storageIn}`, `${label} :: ${keyOf(s, reg)}`);
          if (r.retained !== wantRetained) fail(`I9 retained rent ${r.retained} != ${wantRetained}`, label);
          if (!sp.pruned || sp.deliverableCipher !== null) fail('I9 prune did not mark/clear the escrow', label);
          try { prune(sp, { by: BUYER, now: T0 + 900_000_000 }); fail('I9 second prune succeeded', label); } catch { /* expected */ }
        }
      }
      // I6: every further action on a terminal escrow must throw.
      const attempts = [
        (st, rg) => coSign(st, { by: BUYER }),
        (st, rg) => finalizeClaim(st, { now: T0 + 200_000_000 }),
        (st, rg) => postClaim(st, { by: WORKER, level: 0, verdict: 'PASS', reqHash: freshHash(), respHash: freshHash(), bondPaid: B0, now: T0 + 3, executor: EXEC, escrowKey: 'X' }, rg),
        (st, rg) => dispute(st, { by: BUYER, groundsHash: 'e'.repeat(64), bondPaid: 2n * B0, feePaid: termsOf(st).appealFee, now: T0 + 3 }),
        (st, rg) => expire(st, { now: T0 + 200_000_000 }),
      ];
      for (const fn of attempts) {
        const s2 = structuredClone(s);
        try { fn(s2, new Set(reg)); fail('I6 an action succeeded on a Final escrow', label); } catch { /* expected */ }
      }
      continue;
    }
    for (const a of actions(s, reg)) {
      const s2 = structuredClone(s); const reg2 = new Set(reg);
      let plan = null;
      try { const r = a.fn(s2, reg2); if (r && Array.isArray(r.transfers)) plan = r; } catch { continue; }
      if (plan) checkPlan(s2, plan, a.settleKind || 'plain', `${label} via ${a.name}`);
      const k = keyOf(s2, reg2);
      if (!seen.has(k)) { seen.add(k); queue.push({ s: s2, reg: reg2 }); }
      if (seen.size > 400000) { fail('state cap exceeded', label); return; }
    }
  }
  console.log(`    states visited: ${seen.size}`);
}

explore(NEAR, 'legacy 10% regime');
explore(NEAR / 100n, 'legacy MIN_BOND floor regime');
// v4 parameterized regimes (S8): the money parameters vary across their
// branches — fee zero / cap, bond bps branch / floor branch, B0 == amount —
// while the exploration still enumerates deadline ORDERINGS per escrow.
explore(NEAR, 'v4: fee 0, bond floor branch, custom windows', defaultTerms({ feeSink: SINK, feeBps: 0, bondBps: 100, bondFloor: 5n * 10n ** 22n, wMs: 7_200_000, w1Ms: 1_200_000 }));
explore(NEAR, 'v4: fee cap 10%, bond 25%', defaultTerms({ feeSink: SINK, feeBps: 1000, bondBps: 2500, bondFloor: 10n ** 22n, wMs: 3_600_000, w1Ms: 600_000 }));
explore(10n ** 22n, 'v4: minimum amount, B0 == amount', defaultTerms({ feeSink: SINK, feeBps: 250, bondBps: 1000, bondFloor: 10n ** 22n, wMs: 3_600_000, w1Ms: 1_800_000 }));

console.log(`\ntotal states: ${statesSeen}, settlements checked: ${settlements}, by class: ${JSON.stringify(classCount)}`);
if (failures.length) { console.log(`FAILURES (${failures.length}):`); for (const f of failures.slice(0, 20)) console.log(' -', f); process.exit(1); }
console.log('ALL INVARIANTS HELD over the explored state space');
