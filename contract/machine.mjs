// Sealgate contract core: pure escrow / claim / dispute state machine (SPEC v2 §3).
// No NEAR dependencies — the near-sdk-js wrapper persists this state and executes the
// returned transfer plans. All amounts are BigInt yoctoNEAR. Times are ms epochs
// (the wrapper converts NEAR's ns block timestamps).
//
// v4 parameterization (design review 2026-11-10): parameters live in two
// layers. The CONSTITUTIONAL layer is protocol-fixed: the bond ratios
// (1x/2x/1x and the equal-2xB0 symmetry), the fee's scope (judgment
// settlements only, never bonds, never expiry), one appeal, the reachability
// floors for the remedies (W/2, W1/2), the appeal fee, and the bounds
// themselves. The POLICY layer is chosen per escrow by its creator and
// snapshotted at creation: fee schedule is NOT here — the fee is the
// recipient's term, registered by the platform as a schedule (sink, bps)
// and snapshotted; bond base (bps + floor) and the windows W/W1 are the
// creator's, inside the constitutional bounds. A single helper, termsOf(),
// resolves every escrow's effective terms: v2 escrows store theirs
// explicitly; legacy generations resolve to literal constants (M7 — never
// to owner-mutable state).

export const NEAR = 10n ** 24n;
export const MIN_BOND = 5n * 10n ** 22n; // 0.05 NEAR — LEGACY B0 floor (generations 0/1)
export const W = 3_600_000;              // LEGACY L0 dispute window: 1h
export const W1 = 1_800_000;             // LEGACY L1 window: 30min

// Constitutional bounds for the policy layer (hardcoded; changing them is a
// code change, visible in the code hash — S4).
export const MIN_W_MS = 3_600_000;            // W >= 1h, i.e. W/2 >= 30min (M3)
export const PROTOCOL_MIN_W1_MS = 300_000;    // 5min floor under the executor's own minimum (M2)
export const MAX_WINDOW_MS = 2_592_000_000;   // 30 days, either window (S3)
export const MAX_LIFETIME_MS = 31_536_000_000; // 365 days creation -> final deadline (S3)
export const MAX_FEE_BPS = 1000;              // fee schedule cap: 10% (M1/S9)
export const MIN_BOND_BPS = 100;              // 1%
export const MAX_BOND_BPS = 2500;             // 25% (S1)
export const MIN_BOND_FLOOR = 10n ** 22n;     // 0.01 NEAR: smallest allowed bondFloor (griefing floor)
export const APPEAL_FEE = 10n ** 22n;         // 0.01 NEAR, v2 terms (M8)
export const MIN_AMOUNT = 10n ** 22n;         // 0.01 NEAR, v2 terms (M8)

// Storage economics (v5; production-plan constraint A). On NEAR, state is
// not free: the contract account must hold ~1 NEAR per 100KB of storage,
// i.e. 10^19 yocto per byte. Until v5 the operator silently funded every
// escrow's growth (an undercollateralization risk that grows with usage).
// The rule now: whoever stores bytes funds them, at the protocol's own
// price, as an attached deposit at the write that stores them —
//   create            -> CREATE_STORAGE (record skeleton, keys, terms)
//   submit_deliverable-> per-byte charge on the deliverable ciphertext
//   post_claim        -> per-byte charge on the response ciphertext
// After Final, the ciphertexts can be pruned (hashes, verdicts, signatures
// and the outcome stay on-chain forever); pruning refunds each storage
// payment to its payer, minus RECORD_RENT retained from the create charge
// for the minimal record that remains. Unpruned escrows keep their storage
// funded by the same payments — the money follows the bytes both ways.
export const STORAGE_PRICE_PER_BYTE = 10n ** 19n; // NEAR's storage price
export const CREATE_STORAGE = 3n * 10n ** 22n;    // 0.03 NEAR at creation
export const RECORD_RENT = 10n ** 22n;            // 0.01 NEAR retained at prune
export const PRUNE_DELAY_MS = 604_800_000;        // 7 days after Final, unless both parties consent sooner
export const storageChargeFor = (len) => BigInt(len) * STORAGE_PRICE_PER_BYTE;

// The terms every v2 escrow stores explicitly. The fee (sink, bps) comes
// from the platform's registered schedule at creation time; the rest is the
// creator's choice inside the bounds.
export function defaultTerms({ feeSink = null, feeBps = 0, bondBps = 1000, bondFloor = MIN_BOND, wMs = W, w1Ms = W1, executorMinW1Ms = 600_000, executorMaxW1Ms = 604_800_000 } = {}) {
  return { feeSink, feeBps, bondBps, bondFloor, wMs, w1Ms, appealFee: APPEAL_FEE, executorMinW1Ms, executorMaxW1Ms };
}

// Resolve an escrow's effective terms. v2 escrows (termsVersion === 2) use
// their stored snapshot. Legacy generations resolve to literal constants:
// generation 0 predates the fee (no sink snapshotted), generation 1 is the
// v3 design (1% fee to the snapshotted sink, 10%/0.05 bonds, 1h/30min).
export function termsOf(s) {
  if (s.termsVersion === 2) return { ...s.terms, version: 2 };
  const base = { bondBps: 1000, bondFloor: MIN_BOND, wMs: W, w1Ms: W1, appealFee: 0n, executorMinW1Ms: 0, executorMaxW1Ms: 0 };
  if (!s.feeSink) return { ...base, feeSink: null, feeBps: 0, version: 0 };
  return { ...base, feeSink: s.feeSink, feeBps: 100, version: 1 };
}

export const bondOf = (terms, amount) => {
  const t = (amount * BigInt(terms.bondBps)) / 10000n;
  return t > terms.bondFloor ? t : terms.bondFloor;
};
export const feeOfTerms = (terms, amount) => (amount * BigInt(terms.feeBps)) / 10000n;

// Legacy wrappers (generations 0/1 arithmetic; N1: floor(100a/10000) ===
// floor(a/100) and floor(1000a/10000) === floor(a/10), exact to the yocto).
export const bond0 = (amount) => bondOf({ bondBps: 1000, bondFloor: MIN_BOND }, amount);
export const bond1 = (amount) => bond0(amount) * 2n;
export const feeOf = (amount) => amount / 100n;

const fail = (why) => { throw new Error(why); };
const isInt = (x) => typeof x === 'number' && Number.isSafeInteger(x);

// Validate a proposed v2 terms snapshot against the constitutional bounds.
// `executorReg` is the appellate executor's current registration (its
// declared W1 range binds every escrow that snapshots it — M2/S3).
export function validateTerms(terms, amount, executorReg = null) {
  if (!terms) fail('terms are required');
  if (!isInt(terms.feeBps) || terms.feeBps < 0 || terms.feeBps > MAX_FEE_BPS) fail('feeBps out of range');
  if (terms.feeBps > 0 && !terms.feeSink) fail('a positive fee needs a sink (the fee schedule)');
  if (!isInt(terms.bondBps) || terms.bondBps < MIN_BOND_BPS || terms.bondBps > MAX_BOND_BPS) fail('bondBps out of range');
  const floorCap = (() => { const c = (amount * BigInt(MAX_BOND_BPS)) / 10000n; return c > MIN_BOND_FLOOR ? c : MIN_BOND_FLOOR; })();
  if (typeof terms.bondFloor !== 'bigint' || terms.bondFloor < MIN_BOND_FLOOR) fail('bondFloor below the protocol minimum');
  if (terms.bondFloor > floorCap) fail('bondFloor above the cap (25% of the amount) — it would price the counterparty out of claiming'); // M4
  if (!isInt(terms.wMs) || terms.wMs % 1000 !== 0 || terms.wMs < MIN_W_MS || terms.wMs > MAX_WINDOW_MS) fail('wMs out of range (1h..30d, whole seconds)');
  // H1: an executor that has not declared its W1 range cannot be snapshotted
  // into a v2 escrow — undeclared must not silently mean the 5-minute
  // protocol floor (that is exactly the M2 attack: the respondent funds at
  // once and the ack deadline becomes 2.5 minutes).
  const declaredMin = Math.max(executorReg?.minW1Ms || 0, terms.executorMinW1Ms || 0);
  if (declaredMin <= 0) fail('the appellate executor has not declared a minimum W1 — v2 escrows cannot be created yet');
  const minW1 = Math.max(PROTOCOL_MIN_W1_MS, declaredMin);
  const maxW1 = Math.min(MAX_WINDOW_MS, executorReg?.maxW1Ms || MAX_WINDOW_MS, terms.executorMaxW1Ms || MAX_WINDOW_MS);
  if (!isInt(terms.w1Ms) || terms.w1Ms % 1000 !== 0 || terms.w1Ms < minW1 || terms.w1Ms > maxW1) fail('w1Ms out of range (executor-declared range, whole seconds)');
  if (terms.appealFee !== APPEAL_FEE) fail('appealFee is a protocol constant in v2 terms');
  return terms;
}

export function createEscrow({ buyer, worker = null, amount, criteriaHash, deliverBy = null, settleBy = null, open = false, claimBy = null, deliverWindow = null, settleWindow = null, feeSink = null, caseType = 'inspection', executor = null, executorKey = null, buyerKey = null, workerKey = null, salted = false, terms = null, executorReg = null, now = null, storagePaid = 0n }) {
  if (amount <= 0n) fail('amount must be positive');
  if (caseType !== 'inspection' && caseType !== 'adjudication') fail('caseType must be inspection or adjudication');
  let wMs = W, w1Ms = W1, termsVersion = null, storedTerms = null;
  if (terms) {
    if (amount < MIN_AMOUNT) fail('amount below the protocol minimum');
    validateTerms(terms, amount, executorReg);
    wMs = terms.wMs; w1Ms = terms.w1Ms; termsVersion = 2; storedTerms = terms;
    // v5: a v2 escrow's record skeleton is funded by its creator, exactly.
    if (storagePaid !== CREATE_STORAGE) fail('create storage deposit must equal CREATE_STORAGE exactly');
  } else if (storagePaid !== 0n) fail('legacy-generation escrows carry no storage deposit');

  if (open) {
    // Open job (bounty): no worker yet. The deliver/settle deadlines are
    // anchored when someone claims the job, so a job cannot be claimed
    // into a half-expired lifecycle.
    if (worker !== null) fail('an open job has no worker yet');
    if (!(claimBy > 0)) fail('an open job needs a claim_by deadline');
    if (!(deliverWindow > 0)) fail('an open job needs a deliver window');
    if (!(settleWindow >= wMs + w1Ms)) fail('settle window must cover W + W1');
    if (now !== null && claimBy + deliverWindow + settleWindow + wMs + 2 * w1Ms > now + MAX_LIFETIME_MS) fail('total lifetime (incl. the appeal tail) exceeds the protocol maximum');
    deliverBy = claimBy;
    settleBy = claimBy + settleWindow;
  } else {
    if (!worker) fail('worker is required for a closed escrow');
    if (buyer === worker) fail('buyer and worker must differ');
    if (settleBy <= deliverBy) fail('settle_by must be after deliver_by');
    // The window must fit one full lifecycle: deliver -> L0 window W -> appeal
    // window W1 (round-3 review F10 leftover: no usable escrow otherwise).
    if (settleBy - deliverBy < wMs + w1Ms) fail('window too short: settle_by - deliver_by must cover W + W1');
    if (now !== null && settleBy + wMs + 2 * w1Ms > now + MAX_LIFETIME_MS) fail('total lifetime (incl. the appeal tail) exceeds the protocol maximum');
  }
  // The appellate executor (account + bundle key) is snapshotted at creation
  // (round-3 review N4): no live-registry fallback exists anywhere.
  if (!executor) fail('appellate executor must be registered before creating an escrow');
  if (executor === buyer || (worker && executor === worker)) fail('appellate executor must not be a party');
  return {
    buyer, worker, amount, criteriaHash, deliverBy, settleBy,
    open, claimBy, deliverWindow, settleWindow, feeSink: terms ? terms.feeSink : feeSink, caseType, claimedAt: null,
    executor, executorKey, buyerKey, workerKey, salted,
    termsVersion, terms: storedTerms,
    phase: 'Funded', deliverableHash: null, deliverableCipher: null,
    claims: [], dispute: null, outcome: null,
    // v5 storage accounting (absent/zero on legacy escrows, which the
    // operator funded; pruning them refunds nothing and still frees stake).
    createStorage: storagePaid, deliverableStorage: 0n,
    pruneConsent: [], pruned: false, retainedRent: 0n, finalAt: null,
  };
}

// An open job is claimed by the worker who will do it. Claiming starts the
// lifecycle clocks. The buyer cannot claim their own job; the snapshotted
// executor cannot claim a job whose appeals it would judge.
export function claimJob(s, { by, now }) {
  if (s.phase !== 'Funded') fail(`cannot claim a job in phase ${s.phase}`);
  if (!s.open || s.worker) fail('not an unclaimed open job');
  if (by === s.buyer) fail('the buyer cannot claim their own job');
  if (by === s.executor) fail('the appellate executor cannot claim a job it may have to judge');
  if (now > s.claimBy) fail('claim deadline has passed');
  // The buyer's response key must exist before anyone commits to the job
  // (design review M2): without it no shared key can be derived, the worker
  // could never submit an encrypted deliverable, and the escrow would just
  // expire back to the buyer — a failure the BUYER controls must not be
  // allowed to consume the worker's slot.
  if (!s.buyerKey) fail('the buyer has not registered a response key for this job');
  s.worker = by;
  s.claimedAt = now;
  s.deliverBy = now + s.deliverWindow;
  s.settleBy = s.deliverBy + s.settleWindow;
  return s;
}

// Response keys are registered once per party per escrow and never replaced
// (round-2 review F6-B). Both must exist before any L0 claim (round-3 N1):
// a claim whose response the counterparty cannot decrypt must be impossible
// to post, not merely voidable.
export function registerKey(s, { by, pubkey }) {
  if (by !== s.buyer && by !== s.worker) fail('only a party registers a key');
  if (!/^[0-9a-f]{64}$/.test(pubkey)) fail('pubkey must be 32-byte hex');
  if (by === s.buyer) { if (s.buyerKey) fail('buyer key already registered'); s.buyerKey = pubkey; }
  else { if (s.workerKey) fail('worker key already registered'); s.workerKey = pubkey; }
  return s;
}

export function submitDeliverable(s, { by, deliverableHash, encryptedDeliverable, now, storagePaid = 0n }) {
  if (s.phase !== 'Funded') fail(`cannot deliver in phase ${s.phase}`);
  if (by !== s.worker) fail('only the worker delivers');
  if (now > s.deliverBy) fail('deliver_by has passed');
  // Data availability (round-4 review R1): the deliverable's ciphertext
  // under the parties' shared key is part of the submission. An appeal must
  // never depend on the worker handing the plaintext over afterwards.
  if (!encryptedDeliverable) fail('encrypted deliverable is required');
  if (encryptedDeliverable.length > 16384) fail('encrypted deliverable too large');
  // v5: the worker funds the ciphertext bytes it stores, at the protocol
  // storage price, exactly (v2 escrows; legacy escrows predate the charge).
  const wantStorage = s.termsVersion === 2 ? storageChargeFor(encryptedDeliverable.length) : 0n;
  if (storagePaid !== wantStorage) fail('deliverable storage deposit must equal the per-byte charge exactly');
  s.deliverableHash = deliverableHash;
  s.deliverableCipher = encryptedDeliverable;
  s.deliverableStorage = storagePaid;
  s.phase = 'Delivered';
  return s;
}

// registry: a Set of SCOPED replay keys `${escrowKey}:${level}:${reqHash}`.
// The scope is per escrow (round-2 review F2): canonical requests embed the
// escrow reference, so cross-escrow replay is already impossible for any
// claim that must pass the integrity stage — while a GLOBAL registry let any
// third party permanently burn a future claim's deterministic req_hash via a
// puppet escrow. `escrowKey` identifies the escrow (id or ref string).
// executor: the appellate executor snapshotted on the escrow at creation.
// Since the L1 redesign (2026-11-09), ONLY the executor may post an L1 claim;
// it posts with NO bond (round-2 review F3: a bond that always returns secures
// nothing and only obstructs the executor).
export function postClaim(s, { by, level, verdict, reqHash, respHash, bondPaid, integrityVoid = false, now, executor = null, escrowKey = '', responseBytes = 0, storagePaid = 0n }, registry) {
  if (verdict !== 'PASS' && verdict !== 'FAIL') fail('verdict must be PASS or FAIL');
  const terms = termsOf(s);
  // v5: the claimant funds the response ciphertext bytes it stores, at the
  // protocol storage price, exactly — on top of (never instead of) the bond.
  const wantStorage = s.termsVersion === 2 ? storageChargeFor(responseBytes) : 0n;
  if (storagePaid !== wantStorage) fail('response storage deposit must equal the per-byte charge exactly');
  const replayKey = `${escrowKey}:${level}:${reqHash}`;
  if (registry.has(replayKey)) fail('req_hash already used in this escrow (replay)');
  if (level === 0) {
    if (by !== s.buyer && by !== s.worker) fail('only a party may claim');
    if (s.phase !== 'Delivered') fail(`cannot post L0 claim in phase ${s.phase}`);
    if (now > s.settleBy) fail('claim after settle_by');
    if (!s.buyerKey || !s.workerKey) fail('both parties must register response keys before an L0 claim');
    // Exact bonds (S2): an overpayment is no longer silently slashable; a
    // client computing with the wrong terms fails loudly instead.
    if (bondPaid !== bondOf(terms, s.amount)) fail('claim bond must equal B0 exactly');
  } else if (level === 1) {
    if (!executor) fail('no appellate executor registered');
    if (by !== executor) fail('only the appellate executor may post L1 claims');
    if (bondPaid !== 0n) fail('L1 claims carry no bond');
    if (s.phase !== 'Disputed') fail(`cannot post L1 claim in phase ${s.phase}`);
    if (s.dispute.funded !== true) fail('appeal not funded by the respondent');
    // The L1 deadline runs from FUNDING, not from the L0 claim (round-3 N5):
    // a respondent who funds at the last moment must not compress the
    // executor's working window below W1.
    if (now > s.dispute.fundedAt + terms.w1Ms) fail('appeal not prosecuted within the window (dismissed)');
  } else fail('level must be 0 or 1');
  registry.add(replayKey);
  const claim = { by, level, verdict, reqHash, respHash, bond: bondPaid, integrityVoid, at: now, coSignedBy: [by], storagePaid };
  s.claims.push(claim);
  s.phase = 'Claimed';
  s.windowEnds = now + (level === 0 ? terms.wMs : terms.w1Ms);
  return claim;
}

export function dispute(s, { by, groundsHash, bondPaid, feePaid = 0n, now }) {
  if (s.phase !== 'Claimed') fail(`cannot dispute in phase ${s.phase}`);
  const terms = termsOf(s);
  const claim = s.claims[s.claims.length - 1];
  if (claim.level !== 0) fail('L1 claims are final; no judgment dispute exists at L1');
  if (by === claim.by) fail('the claimant cannot dispute their own claim');
  if (by !== s.buyer && by !== s.worker) fail('only a party may dispute');
  if (now > s.windowEnds) fail('dispute window has closed');
  // Appellant must fund within the first half of the L0 window (PARAMETERS.md §1).
  if (now > claim.at + terms.wMs / 2) fail('dispute window has closed (appellant must fund within W/2)');
  if (bondPaid !== bondOf(terms, s.amount) * 2n) fail('dispute bond must equal 2xB0 exactly');
  // The appeal fee (M8) is the executor's price for prosecuting an appeal,
  // separate from the bonds (which move only between the parties). Bonds
  // alone cannot price it: a Sybil pair's bonds cancel out.
  if (feePaid !== terms.appealFee) fail('appeal fee must be paid exactly');
  s.dispute = { by, groundsHash, bond: bondPaid, appealFee: feePaid, at: now, respondentBond: 0n, funded: false, fundedAt: null, acked: false, ackedAt: null };
  s.phase = 'Disputed';
  return s.dispute;
}

// The L0 claimant (respondent) funds its side of the appeal: B0 by claim time + W.
export function respondDispute(s, { by, bondPaid, now }) {
  if (s.phase !== 'Disputed') fail(`cannot respond in phase ${s.phase}`);
  const terms = termsOf(s);
  const l0 = s.claims[0];
  if (by !== l0.by) fail('only the L0 claimant may respond');
  if (s.dispute.funded !== false) fail('appeal already funded');
  if (now > l0.at + terms.wMs) fail('response window has closed');
  if (bondPaid !== bondOf(terms, s.amount)) fail('response bond must equal B0 exactly');
  s.dispute.respondentBond = bondPaid;
  s.dispute.funded = true;
  s.dispute.fundedAt = now;
  return s.dispute;
}

// The executor acknowledges on-chain that it has accepted a verified appeal
// bundle (round-3 review N3). This is what attributes a later lapse: acked +
// no L1 = executor silence (all bonds return); never acked = the appellant
// did not prosecute (the appellant's dispute bond goes to the claimant).
export function ackBundle(s, { by, now }) {
  if (s.phase !== 'Disputed') fail(`cannot ack in phase ${s.phase}`);
  const terms = termsOf(s);
  if (by !== s.executor) fail('only the snapshotted appellate executor may ack');
  if (s.dispute.acked) return s.dispute; // idempotent: a re-run must not brick itself
  // The ack means "a verified bundle was received" and may be recorded
  // before the respondent funds (round-4 review R4). Once funding exists it
  // has a deadline (R2): an ack in the second half of the L1 window would
  // let the appellant buy an "acked lapse" with a last-minute bundle.
  if (s.dispute.funded === true && now > s.dispute.fundedAt + terms.w1Ms / 2) fail('ack deadline has passed (funding time + W1/2)');
  s.dispute.acked = true;
  s.dispute.ackedAt = now;
  return s.dispute;
}

export function coSign(s, { by, now }) {
  if (s.phase !== 'Claimed') fail(`cannot co-sign in phase ${s.phase}`);
  const claim = s.claims[s.claims.length - 1];
  if (by !== s.buyer && by !== s.worker) fail('only a party may co-sign');
  if (!claim.coSignedBy.includes(by)) claim.coSignedBy.push(by);
  if (claim.coSignedBy.includes(s.buyer) && claim.coSignedBy.includes(s.worker)) {
    // Mutual co-signature is fast finality: it settles immediately, inside
    // the window, so the window check in finalizeClaim must not apply —
    // finalize without `now`, then stamp the finality time for prune.
    const plan = finalizeClaim(s);
    if (plan && now !== undefined) s.finalAt = now;
    return plan;
  }
  return null;
}

// Execute the current claim if its window has closed (or a dispute lapsed).
// Returns a transfer plan; sets phase Final.
export function finalizeClaim(s, { now } = {}) {
  const terms = termsOf(s);
  if (s.phase === 'Disputed') {
    // Terminal cases are time-dependent, so `now` is required here.
    if (now === undefined) fail('now is required to finalize a disputed escrow');
    const l0 = s.claims[0];
    if (!s.dispute.funded) {
      if (now <= l0.at + terms.wMs) fail('response window still open');
      // DEFAULT OVERTURN: respondent never funded; the negated L0 verdict stands.
      const plan = settleDefault(s);
      s.phase = 'Final';
      s.finalAt = now;
      return plan;
    }
    if (now <= s.dispute.fundedAt + terms.w1Ms) fail('appeal window still open');
    // LAPSED: funded but no L1 claim posted in time; the L0 claim stands.
    // Bond treatment depends on the executor's ack (see settleOnClaim).
    const plan = settleOnClaim(s, l0);
    s.phase = 'Final';
    s.finalAt = now;
    return plan;
  }
  if (s.phase !== 'Claimed') fail(`cannot finalize in phase ${s.phase}`);
  if (now !== undefined && now <= s.windowEnds) fail('window still open');
  const claim = s.claims[s.claims.length - 1];
  const plan = settleOnClaim(s, claim);
  s.phase = 'Final';
  if (now !== undefined) s.finalAt = now;
  return plan;
}

const negate = (v) => (v === 'PASS' ? 'FAIL' : 'PASS');

// The escrow amount's disbursement, split by the platform fee under the
// escrow's resolved terms. Generations without a fee pay none.
function escrowTransfers(s, recipient) {
  const terms = termsOf(s);
  const fee = feeOfTerms(terms, s.amount);
  const t = [{ to: recipient, amount: s.amount - fee, kind: 'escrow' }];
  if (fee > 0n) t.push({ to: terms.feeSink, amount: fee, kind: 'fee' });
  return t;
}

// The appeal fee's fate: it pays the executor only when an L1 claim was
// actually posted (the panel was consumed). Every other ending — default
// overturn, lapse acked or not — refunds it to the appellant (M8).
function appealFeeTransfer(s, posted) {
  const fee = s.dispute?.appealFee ?? 0n;
  if (fee <= 0n) return [];
  return [posted
    ? { to: s.executor, amount: fee, kind: 'appeal-fee' }
    : { to: s.dispute.by, amount: fee, kind: 'appeal-fee-refund' }];
}

function settleDefault(s) {
  const l0 = s.claims[0];
  const outcome = negate(l0.verdict);
  const transfers = [
    ...escrowTransfers(s, outcome === 'PASS' ? s.worker : s.buyer),
    { to: s.dispute.by, amount: s.dispute.bond, kind: 'bond-return' },
    { to: s.dispute.by, amount: l0.bond, kind: 'bond-slash-to-disputer' },
    ...appealFeeTransfer(s, false),
  ];
  s.outcome = outcome;
  s.defaulted = true;
  return { outcome, defaulted: true, transfers: transfers.filter((t) => t.amount > 0n) };
}

function settleOnClaim(s, finalClaim) {
  const transfers = [];
  const outcome = finalClaim.verdict;
  transfers.push(...escrowTransfers(s, outcome === 'PASS' ? s.worker : s.buyer));
  // The deciding claim's own bond always returns to its poster.
  transfers.push({ to: finalClaim.by, amount: finalClaim.bond, kind: 'bond-return' });
  const l0 = s.claims[0];
  if (s.dispute && finalClaim !== l0) {
    // An appellate claim decided (PARAMETERS.md §1 resolution table).
    transfers.push(...appealFeeTransfer(s, true));
    const overturned = finalClaim.verdict !== l0.verdict;
    if (finalClaim.integrityVoid || overturned) {
      // Claimant's B0 + response B0 go to the appellant; appellant's 2xB0 returns.
      transfers.push({ to: s.dispute.by, amount: l0.bond, kind: 'bond-slash-to-disputer' });
      transfers.push({ to: s.dispute.by, amount: s.dispute.respondentBond, kind: 'bond-slash-to-disputer' });
      transfers.push({ to: s.dispute.by, amount: s.dispute.bond, kind: 'bond-return' });
    } else {
      // Upheld: appellant's 2xB0 goes to the claimant; claimant's B0 + response B0 return.
      transfers.push({ to: l0.by, amount: l0.bond, kind: 'bond-return' });
      transfers.push({ to: l0.by, amount: s.dispute.respondentBond, kind: 'bond-return' });
      transfers.push({ to: l0.by, amount: s.dispute.bond, kind: 'bond-to-claimant' });
    }
  } else if (s.dispute) {
    // Funded appeal lapsed with no L1 claim. Attribution decides the bonds
    // (round-3 review N3):
    transfers.push(...appealFeeTransfer(s, false));
    if (s.dispute.acked) {
      // The executor accepted the bundle and then stayed silent (malice,
      // outage, or an AI pipeline failure): the appellant prosecuted, so no
      // bond moves between the parties; everything returns to its poster.
      transfers.push({ to: s.dispute.by, amount: s.dispute.bond, kind: 'bond-return' });
      transfers.push({ to: l0.by, amount: s.dispute.respondentBond, kind: 'bond-return' });
    } else {
      // The executor never acked: the appellant funded but did not prosecute
      // (no bundle, an unverifiable bundle, a bundle never delivered). The
      // free-option appeal is closed: the appellant's 2xB0 goes to the
      // claimant; the response bond returns.
      transfers.push({ to: l0.by, amount: s.dispute.bond, kind: 'bond-to-claimant' });
      transfers.push({ to: l0.by, amount: s.dispute.respondentBond, kind: 'bond-return' });
    }
  }
  s.outcome = outcome;
  return { outcome, transfers: transfers.filter((t) => t.amount > 0n) };
}

export function expire(s, { now }) {
  if (s.phase === 'Funded' && s.open && !s.worker && now > s.claimBy) {
    // An open job nobody claimed: refund in full (no judgment, no fee).
    s.phase = 'Final'; s.outcome = 'REFUND'; s.finalAt = now;
    return { outcome: 'REFUND', transfers: [{ to: s.buyer, amount: s.amount, kind: 'escrow' }] };
  }
  if (s.phase === 'Funded' && now > s.deliverBy) {
    s.phase = 'Final'; s.outcome = 'REFUND'; s.finalAt = now;
    return { outcome: 'REFUND', transfers: [{ to: s.buyer, amount: s.amount, kind: 'escrow' }] };
  }
  if (s.phase === 'Delivered' && now > s.settleBy) {
    s.phase = 'Final'; s.outcome = 'REFUND'; s.finalAt = now;
    return { outcome: 'REFUND', transfers: [{ to: s.buyer, amount: s.amount, kind: 'escrow' }] };
  }
  fail(`nothing expirable in phase ${s.phase}`);
}

// Prune a Final escrow's ciphertexts (v5 storage economics). The hashes,
// verdicts, signatures, bonds record and outcome stay on-chain; only the
// bulky ciphertexts (deliverable + claim responses) are deleted, and the
// wrapper performs the deletion. What the machine settles here is the
// money: every storage payment returns to its payer, minus RECORD_RENT
// retained from the creator's create charge for the record that remains.
//
// Timing: pruning destroys the parties' on-chain recovery copy, so it
// needs either BOTH parties' consent (each party calls prune once) or the
// retention delay after finality (PRUNE_DELAY_MS), after which anyone may
// execute it. A consent call that cannot execute yet only records consent.
export function prune(s, { by, now }) {
  if (s.phase !== 'Final') fail(`cannot prune in phase ${s.phase}`);
  if (s.pruned) fail('escrow already pruned');
  if (!Array.isArray(s.pruneConsent)) s.pruneConsent = [];
  if ((by === s.buyer || (s.worker && by === s.worker)) && !s.pruneConsent.includes(by)) s.pruneConsent.push(by);
  const buyerOk = s.pruneConsent.includes(s.buyer);
  const workerOk = !s.worker || s.pruneConsent.includes(s.worker);
  const delayed = s.finalAt !== null && s.finalAt !== undefined && now >= s.finalAt + PRUNE_DELAY_MS;
  if (!(buyerOk && workerOk) && !delayed) return { executed: false, transfers: [], retained: 0n };
  const transfers = [];
  if (s.deliverableCipher && (s.deliverableStorage ?? 0n) > 0n) transfers.push({ to: s.worker, amount: s.deliverableStorage, kind: 'storage-refund' });
  for (const c of s.claims) if ((c.storagePaid ?? 0n) > 0n) transfers.push({ to: c.by, amount: c.storagePaid, kind: 'storage-refund' });
  let retained = 0n;
  if ((s.createStorage ?? 0n) > 0n) { retained = RECORD_RENT; transfers.push({ to: s.buyer, amount: s.createStorage - RECORD_RENT, kind: 'storage-refund' }); }
  s.deliverableCipher = null;
  s.deliverableStorage = 0n;
  for (const c of s.claims) c.storagePaid = 0n;
  s.createStorage = 0n;
  s.retainedRent = retained;
  s.pruned = true;
  return { executed: true, transfers: transfers.filter((t) => t.amount > 0n), retained };
}
