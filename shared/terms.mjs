// Chain-side terms resolution (v4 parameterization).
//
// An escrow's effective terms are resolved from its on-chain record exactly
// as the contract resolves them (contract.ts termsOf / machine.mjs termsOf):
// generation 2 stores the snapshot explicitly; generations 0/1 resolve to
// literal constants. The canonical serialization and its sha256 are the
// consent artifact (S6): claim_job and the worker's register_key must name
// this hash, so accepting a job or an engagement means accepting THESE terms.
import { createHash } from 'node:crypto';

export const LEGACY_MIN_BOND = 5n * 10n ** 22n; // 0.05 NEAR
export const PROTOCOL_DEFAULTS = { feeBps: 100, bondBps: 1000, bondFloor: LEGACY_MIN_BOND, wMs: 3_600_000, w1Ms: 1_800_000, appealFee: 10n ** 22n };

export function termsOfChain(e) {
  if (e.termsVersion === 2 && e.terms) return { ...e.terms, version: 2 };
  const base = { bondBps: 1000, bondFloor: LEGACY_MIN_BOND.toString(), wMs: 3_600_000, w1Ms: 1_800_000, appealFee: '0', executorMinW1Ms: 0, executorMaxW1Ms: 0 };
  if (!e.feeSink) return { ...base, feeSink: null, feeBps: 0, version: 0 };
  return { ...base, feeSink: e.feeSink, feeBps: 100, version: 1 };
}

export function canonicalTerms(e) {
  const t = termsOfChain(e);
  // Format v2 (the string carries its own version: N5) — identical to the
  // contract's canonicalTerms. It binds the amount, the lifecycle anchors
  // and the executor's bundle key as well as the money terms (D5).
  const anchors = e.open ? `${e.claimBy}|${e.deliverWindow}|${e.settleWindow}` : `${e.deliverBy}|${e.settleBy}`;
  return `sealgate-terms2|${t.version}|${t.feeSink ?? ''}|${t.feeBps}|${t.bondBps}|${t.bondFloor}|${t.wMs}|${t.w1Ms}|${t.appealFee}|${e.caseType ?? 'inspection'}|${e.appellateExecutor ?? ''}|${e.appellateExecutorKey ?? ''}|${e.amount}|${anchors}`;
}

export function termsHash(e) {
  return createHash('sha256').update(canonicalTerms(e)).digest('hex');
}

export function bondOfChain(e) {
  const t = termsOfChain(e);
  const x = (BigInt(e.amount) * BigInt(t.bondBps)) / 10000n;
  const f = BigInt(t.bondFloor);
  return x > f ? x : f;
}

export function feeOfChain(e) {
  const t = termsOfChain(e);
  return (BigInt(e.amount) * BigInt(t.feeBps)) / 10000n;
}

export const fmtNear = (yocto) => {
  const v = BigInt(yocto);
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
};

export const fmtDur = (ms) => (ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}min` : `${ms / 1000}s`);

// Human-readable terms for the engagement surface (M5). Non-default values
// are flagged so a claimer (human or agent) sees what it is accepting.
export function describeTerms(e) {
  const t = termsOfChain(e);
  const amt = BigInt(e.amount);
  const b0 = bondOfChain(e);
  const fee = feeOfChain(e);
  const d = PROTOCOL_DEFAULTS;
  const flag = (cond) => (cond ? '  <-- non-default' : '');
  return [
    `terms (generation ${t.version}, hash ${termsHash(e).slice(0, 12)}…):`,
    `  platform fee: ${t.feeBps / 100}% (${fmtNear(fee)} NEAR) to ${t.feeSink ?? '(none)'} — net on PASS ${fmtNear(amt - fee)} NEAR${flag(t.feeBps !== d.feeBps)}`,
    `  bonds: B0 = ${fmtNear(b0)} NEAR (claim 1x, dispute 2x, response 1x; rate ${t.bondBps / 100}%, floor ${fmtNear(t.bondFloor)} NEAR)${flag(t.bondBps !== d.bondBps || BigInt(t.bondFloor) !== d.bondFloor)}`,
    `  windows: dispute W = ${fmtDur(t.wMs)} (dispute by +${fmtDur(t.wMs / 2)}, response by +${fmtDur(t.wMs)}), appeal W1 = ${fmtDur(t.w1Ms)} (ack by +${fmtDur(t.w1Ms / 2)} after funding)${flag(t.wMs !== d.wMs || t.w1Ms !== d.w1Ms)}`,
    `  appeal fee: ${fmtNear(t.appealFee)} NEAR (paid by the appellant, to the executor only if an L1 claim posts)`,
    `  lifecycle: ${e.open ? `claim by ${new Date(e.claimBy).toISOString()}, then deliver within ${fmtDur(e.deliverWindow)}, settle window ${fmtDur(e.settleWindow)}` : `deliver by ${new Date(e.deliverBy).toISOString()}, settle by ${new Date(e.settleBy).toISOString()}`}`,
    `  appellate executor: ${e.appellateExecutor ?? '(none)'}`,
  ];
}
