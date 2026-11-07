// Sealgate contract core: pure escrow / claim / dispute state machine (SPEC v2 §3).
// No NEAR dependencies — the near-sdk-js wrapper persists this state and executes the
// returned transfer plans. All amounts are BigInt yoctoNEAR. Times are ms epochs
// (the wrapper converts NEAR's ns block timestamps).

export const NEAR = 10n ** 24n;
export const MIN_BOND = 5n * 10n ** 22n; // 0.05 NEAR
export const W = 3_600_000;              // L0 dispute window: 1h (demo default)
export const W1 = 1_800_000;             // L1 window: 30min

export const bond0 = (amount) => { const t = amount / 10n; return t > MIN_BOND ? t : MIN_BOND; };
export const bond1 = (amount) => bond0(amount) * 2n;

const fail = (why) => { throw new Error(why); };

export function createEscrow({ buyer, worker, amount, criteriaHash, deliverBy, settleBy }) {
  if (buyer === worker) fail('buyer and worker must differ');
  if (amount <= 0n) fail('amount must be positive');
  return {
    buyer, worker, amount, criteriaHash, deliverBy, settleBy,
    phase: 'Funded', deliverableHash: null,
    claims: [], dispute: null, outcome: null,
  };
}

export function submitDeliverable(s, { by, deliverableHash, now }) {
  if (s.phase !== 'Funded') fail(`cannot deliver in phase ${s.phase}`);
  if (by !== s.worker) fail('only the worker delivers');
  if (now > s.deliverBy) fail('deliver_by has passed');
  s.deliverableHash = deliverableHash;
  s.phase = 'Delivered';
  return s;
}

// registry: a Set of req_hash values already used by ANY escrow (replay protection).
export function postClaim(s, { by, level, verdict, reqHash, respHash, bondPaid, integrityVoid = false, now }, registry) {
  if (by !== s.buyer && by !== s.worker) fail('only a party may claim');
  if (verdict !== 'PASS' && verdict !== 'FAIL') fail('verdict must be PASS or FAIL');
  if (registry.has(reqHash)) fail('req_hash already used (replay)');
  if (level === 0) {
    if (s.phase !== 'Delivered') fail(`cannot post L0 claim in phase ${s.phase}`);
    if (bondPaid < bond0(s.amount)) fail('claim bond below B0');
  } else if (level === 1) {
    if (s.phase !== 'Disputed') fail(`cannot post L1 claim in phase ${s.phase}`);
    if (s.dispute.funded !== true) fail('appeal not funded by the respondent');
    if (bondPaid < bond0(s.amount)) fail('appellate claim bond below B0');
    if (now > s.claims[0].at + W + W1) fail('appeal not prosecuted within the window (dismissed)');
  } else fail('level must be 0 or 1');
  registry.add(reqHash);
  const claim = { by, level, verdict, reqHash, respHash, bond: bondPaid, integrityVoid, at: now, coSignedBy: [by] };
  s.claims.push(claim);
  s.phase = 'Claimed';
  s.windowEnds = now + (level === 0 ? W : W1);
  return claim;
}

export function dispute(s, { by, groundsHash, bondPaid, now }) {
  if (s.phase !== 'Claimed') fail(`cannot dispute in phase ${s.phase}`);
  const claim = s.claims[s.claims.length - 1];
  if (claim.level !== 0) fail('L1 claims are final; no judgment dispute exists at L1');
  if (by === claim.by) fail('the claimant cannot dispute their own claim');
  if (by !== s.buyer && by !== s.worker) fail('only a party may dispute');
  if (now > s.windowEnds) fail('dispute window has closed');
  // Appellant must fund within the first half of the L0 window (PARAMETERS.md §1).
  if (now > claim.at + W / 2) fail('dispute window has closed (appellant must fund within W/2)');
  if (bondPaid < bond1(s.amount)) fail('dispute bond below 2xB0');
  s.dispute = { by, groundsHash, bond: bondPaid, at: now, respondentBond: 0n, funded: false };
  s.phase = 'Disputed';
  return s.dispute;
}

// The L0 claimant (respondent) funds its side of the appeal: B0 by claim time + W.
export function respondDispute(s, { by, bondPaid, now }) {
  if (s.phase !== 'Disputed') fail(`cannot respond in phase ${s.phase}`);
  const l0 = s.claims[0];
  if (by !== l0.by) fail('only the L0 claimant may respond');
  if (s.dispute.funded !== false) fail('appeal already funded');
  if (now > l0.at + W) fail('response window has closed');
  if (bondPaid < bond0(s.amount)) fail('response bond below B0');
  s.dispute.respondentBond = bondPaid;
  s.dispute.funded = true;
  return s.dispute;
}

export function coSign(s, { by }) {
  if (s.phase !== 'Claimed') fail(`cannot co-sign in phase ${s.phase}`);
  const claim = s.claims[s.claims.length - 1];
  if (by !== s.buyer && by !== s.worker) fail('only a party may co-sign');
  if (!claim.coSignedBy.includes(by)) claim.coSignedBy.push(by);
  if (claim.coSignedBy.includes(s.buyer) && claim.coSignedBy.includes(s.worker)) return finalizeClaim(s);
  return null;
}

// Execute the current claim if its window has closed (or a dispute lapsed).
// Returns a transfer plan; sets phase Final.
export function finalizeClaim(s, { now } = {}) {
  if (s.phase === 'Disputed') {
    // Terminal cases are time-dependent, so `now` is required here.
    if (now === undefined) fail('now is required to finalize a disputed escrow');
    const l0 = s.claims[0];
    if (!s.dispute.funded) {
      if (now <= l0.at + W) fail('response window still open');
      // DEFAULT OVERTURN: respondent never funded; the negated L0 verdict stands.
      const plan = settleDefault(s);
      s.phase = 'Final';
      return plan;
    }
    if (now <= l0.at + W + W1) fail('appeal window still open');
    // DISMISSED: funded but no L1 claim posted in time; the L0 claim stands.
    const plan = settleOnClaim(s, l0);
    s.phase = 'Final';
    return plan;
  }
  if (s.phase !== 'Claimed') fail(`cannot finalize in phase ${s.phase}`);
  if (now !== undefined && now <= s.windowEnds) fail('window still open');
  const claim = s.claims[s.claims.length - 1];
  const plan = settleOnClaim(s, claim);
  s.phase = 'Final';
  return plan;
}

const negate = (v) => (v === 'PASS' ? 'FAIL' : 'PASS');

function settleDefault(s) {
  const l0 = s.claims[0];
  const outcome = negate(l0.verdict);
  const transfers = [
    { to: outcome === 'PASS' ? s.worker : s.buyer, amount: s.amount, kind: 'escrow' },
    { to: s.dispute.by, amount: s.dispute.bond, kind: 'bond-return' },
    { to: s.dispute.by, amount: l0.bond, kind: 'bond-slash-to-disputer' },
  ];
  s.outcome = outcome;
  s.defaulted = true;
  return { outcome, defaulted: true, transfers: transfers.filter((t) => t.amount > 0n) };
}

function settleOnClaim(s, finalClaim) {
  const transfers = [];
  const outcome = finalClaim.verdict;
  transfers.push({ to: outcome === 'PASS' ? s.worker : s.buyer, amount: s.amount, kind: 'escrow' });
  // The deciding claim's own bond always returns to its poster.
  transfers.push({ to: finalClaim.by, amount: finalClaim.bond, kind: 'bond-return' });
  const l0 = s.claims[0];
  if (s.dispute && finalClaim !== l0) {
    // An appellate claim decided (PARAMETERS.md §1 resolution table).
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
    // Funded appeal dismissed (no L1 claim): L0 claim stands; L0 bond already returned
    // above as the deciding claim's bond. Appellant's 2xB0 goes to the claimant; the
    // response bond returns.
    transfers.push({ to: l0.by, amount: s.dispute.bond, kind: 'bond-to-claimant' });
    transfers.push({ to: l0.by, amount: s.dispute.respondentBond, kind: 'bond-return' });
  }
  s.outcome = outcome;
  return { outcome, transfers: transfers.filter((t) => t.amount > 0n) };
}

export function expire(s, { now }) {
  if (s.phase === 'Funded' && now > s.deliverBy) {
    s.phase = 'Final'; s.outcome = 'REFUND';
    return { outcome: 'REFUND', transfers: [{ to: s.buyer, amount: s.amount, kind: 'escrow' }] };
  }
  if (s.phase === 'Delivered' && now > s.settleBy) {
    s.phase = 'Final'; s.outcome = 'REFUND';
    return { outcome: 'REFUND', transfers: [{ to: s.buyer, amount: s.amount, kind: 'escrow' }] };
  }
  fail(`nothing expirable in phase ${s.phase}`);
}
