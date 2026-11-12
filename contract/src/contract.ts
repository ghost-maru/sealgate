// Sealgate contract (SPEC v2) — near-sdk-js wrapper around the state machine whose
// reference logic lives in ../machine.mjs (unit-tested off-chain). Amounts are stored
// as decimal strings; all payouts credit internal balances (deposit model, SPEC v1 §2);
// `withdraw` is the only method that moves NEAR out.
import { NearBindgen, near, call, view, initialize, UnorderedMap } from 'near-sdk-js';

const NEAR = 10n ** 24n;
const MIN_BOND = 5n * 10n ** 22n; // 0.05 NEAR
const W = 3_600_000;              // L0 dispute window (ms): 1h demo default
const W1 = 1_800_000;             // L1 window (ms): 30min
const MAX_CIPHERTEXT_LEN = 12288;  // cap on the base64 ciphertext: L0 bucket is 1400 chars; the L1 bucket (8192B padded, for reasoning-model responses) is 10976

const bond0 = (amount: bigint): bigint => { const t = amount / 10n; return t > MIN_BOND ? t : MIN_BOND; };
const nowMs = (): number => Number(near.blockTimestamp() / 1_000_000n);
const s2b = (s: string): bigint => BigInt(s);

// --- v4 parameterization (design review 2026-11-10) ---
// Constitutional bounds: hardcoded, so changing them changes the code hash
// (S4). The policy layer (per-escrow terms) lives inside these bounds.
const MIN_W_MS = 3_600_000;             // W >= 1h so W/2 >= 30min: the forgery remedy stays reachable (M3)
const PROTOCOL_MIN_W1_MS = 300_000;     // floor under the executor's declared minimum (M2)
const MAX_WINDOW_MS = 2_592_000_000;    // 30 days (S3)
const MAX_LIFETIME_MS = 31_536_000_000; // 365 days (S3)
const MAX_FEE_BPS = 1000;               // fee schedule cap (M1/S9)
const MIN_BOND_BPS = 100; const MAX_BOND_BPS = 2500; // 1%..25% (S1)
const MIN_BOND_FLOOR = 10n ** 22n;      // 0.01 NEAR
const APPEAL_FEE = 10n ** 22n;          // 0.01 NEAR (M8)
const MIN_AMOUNT = 10n ** 22n;          // 0.01 NEAR (M8)

// Storage economics (v5; mirror of machine.mjs): whoever stores bytes
// funds them at the protocol's storage price (10^19 yocto/byte), as an
// attached deposit at the storing write. Pruning a Final escrow's
// ciphertexts refunds each payment to its payer, minus RECORD_RENT.
const STORAGE_PRICE_PER_BYTE = 10n ** 19n;
const CREATE_STORAGE = 3n * 10n ** 22n;   // 0.03 NEAR at creation
const RECORD_RENT = 10n ** 22n;           // 0.01 NEAR retained at prune
const PRUNE_DELAY_MS = 604_800_000;       // 7 days
const storageChargeFor = (len: number): bigint => BigInt(len) * STORAGE_PRICE_PER_BYTE;

// Strict argument validation (M6): near-sdk-js passes JSON through unchecked,
// and a string in a numeric field turns `+` into concatenation downstream.
const intArg = (x: any, name: string): number => {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) throw new Error(`${name} must be an integer`);
  return x;
};
const amtArg = (x: any, name: string): bigint => {
  if (typeof x !== 'string' || !/^[0-9]+$/.test(x)) throw new Error(`${name} must be a decimal integer string`);
  return BigInt(x);
};

type Terms = { feeSink: string | null; feeBps: number; bondBps: number; bondFloor: string; wMs: number; w1Ms: number; appealFee: string; executorMinW1Ms: number; executorMaxW1Ms: number };

// Resolve an escrow's effective terms (mirror of machine.mjs termsOf; M7:
// legacy generations resolve to literal constants, never to owner state).
function termsOf(e: Escrow): Terms & { version: number } {
  if ((e as any).termsVersion === 2 && (e as any).terms) return { ...(e as any).terms, version: 2 };
  const base = { bondBps: 1000, bondFloor: MIN_BOND.toString(), wMs: W, w1Ms: W1, appealFee: '0', executorMinW1Ms: 0, executorMaxW1Ms: 0 };
  if (!e.feeSink) return { ...base, feeSink: null, feeBps: 0, version: 0 };
  return { ...base, feeSink: e.feeSink, feeBps: 100, version: 1 };
}
const bondOf = (t: Terms, amount: bigint): bigint => { const x = (amount * BigInt(t.bondBps)) / 10000n; const f = s2b(t.bondFloor); return x > f ? x : f; };
const feeOfTerms = (t: Terms, amount: bigint): bigint => (amount * BigInt(t.feeBps)) / 10000n;

// Canonical terms serialization + hash (S6): identical in the CLI
// (shared/terms.mjs). Consent to these terms is what claim/register prove.
function canonicalTerms(e: Escrow): string {
  const t = termsOf(e);
  // Format v2 (the string carries its own version: N5). Beyond the money
  // terms it binds the amount, the lifecycle anchors and the executor's
  // bundle key (D5): consent to a hash must be consent to the whole deal.
  const anchors = e.open ? `${e.claimBy}|${e.deliverWindow}|${e.settleWindow}` : `${e.deliverBy}|${e.settleBy}`;
  return `sealgate-terms2|${t.version}|${t.feeSink ?? ''}|${t.feeBps}|${t.bondBps}|${t.bondFloor}|${t.wMs}|${t.w1Ms}|${t.appealFee}|${e.caseType || 'inspection'}|${e.appellateExecutor ?? ''}|${e.appellateExecutorKey ?? ''}|${e.amount}|${anchors}`;
}
// The NEAR runtime (QuickJS) has no TextEncoder. The canonical terms string
// is ASCII in practice (account ids, hex, digits), but encode UTF-8 properly
// so a non-ASCII account id could never desync the hash from the CLI's.
function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(++i);
      cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xd800);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}
// Argument shape validation (Fable review M-1): hashes and signature fields
// are stored on-chain at the caller's length — unbounded strings let anyone
// bloat contract storage (each 100KB of storage stake is ~1 NEAR the
// contract must hold) and smuggle markup into the verifier site. Every hash
// is a sha256 hex digest; signature material has generous but finite caps.
const HEX64 = /^[0-9a-f]{64}$/;
function hashArg(v: unknown, name: string): string {
  if (typeof v !== 'string' || !HEX64.test(v)) throw new Error(`${name} must be a 64-char lowercase hex hash`);
  return v;
}
function strArg(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new Error(`${name} must be a string of 1..${max} chars`);
  return v;
}
function termsHashOf(e: Escrow): string {
  const bytes = near.sha256(utf8Encode(canonicalTerms(e)));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Validate a proposed v2 terms snapshot against the constitutional bounds
// and the executor's declared W1 range (mirror of machine.mjs validateTerms).
function validateTerms(t: Terms, amount: bigint, execMinW1: number, execMaxW1: number) {
  if (!Number.isSafeInteger(t.feeBps) || t.feeBps < 0 || t.feeBps > MAX_FEE_BPS) throw new Error('feeBps out of range');
  if (t.feeBps > 0 && !t.feeSink) throw new Error('a positive fee needs a sink (the fee schedule)');
  if (!Number.isSafeInteger(t.bondBps) || t.bondBps < MIN_BOND_BPS || t.bondBps > MAX_BOND_BPS) throw new Error('bondBps out of range');
  const floor = s2b(t.bondFloor);
  const capRaw = (amount * BigInt(MAX_BOND_BPS)) / 10000n; const floorCap = capRaw > MIN_BOND_FLOOR ? capRaw : MIN_BOND_FLOOR;
  if (floor < MIN_BOND_FLOOR) throw new Error('bondFloor below the protocol minimum');
  if (floor > floorCap) throw new Error('bondFloor above the cap (25% of the amount)');
  if (!Number.isSafeInteger(t.wMs) || t.wMs % 1000 !== 0 || t.wMs < MIN_W_MS || t.wMs > MAX_WINDOW_MS) throw new Error('wMs out of range (1h..30d, whole seconds)');
  const minW1 = Math.max(PROTOCOL_MIN_W1_MS, execMinW1 || 0);
  const maxW1 = Math.min(MAX_WINDOW_MS, execMaxW1 || MAX_WINDOW_MS);
  if (!Number.isSafeInteger(t.w1Ms) || t.w1Ms % 1000 !== 0 || t.w1Ms < minW1 || t.w1Ms > maxW1) throw new Error('w1Ms out of range (executor-declared range, whole seconds)');
  if (s2b(t.appealFee) !== APPEAL_FEE) throw new Error('appealFee is a protocol constant in v2 terms');
}

type Claim = {
  by: string; level: number; verdict: string; reqHash: string; respHash: string;
  signature: string; signingAddress: string; signingAlgo: string; signatureKind: string;
  encryptedResponse: string; bond: string; integrityVoid: boolean;
  at: number; coSignedBy: string[];
  storagePaid?: string; // v5: per-byte charge paid for the response ciphertext
};
type Escrow = {
  buyer: string; worker: string | null; amount: string; criteriaHash: string;
  open: boolean; claimBy: number; deliverWindow: number; settleWindow: number; claimedAt: number; // open jobs (v3); absent on legacy escrows
  feeSink: string | null; // platform fee recipient, snapshotted at creation (v3); absent on legacy escrows
  caseType: string; // 'inspection' | 'adjudication', fixed at creation (design review M5); absent (= inspection) on legacy escrows
  appellateExecutor: string | null; // snapshot at creation (round-2 review F4)
  appellateExecutorKey: string | null; // executor's X25519 bundle key, snapshotted too (round-3 review N4)
  salted: boolean; // commitments are salted (round-4 review R6: no history-dependent rules)
  deliverableHash: string | null; deliverableCipher: string | null; // ciphertext under the parties' key (R1)
  deliverBy: number; settleBy: number;
  phase: string; claims: Claim[];
  buyerKey: string | null; workerKey: string | null;
  dispute: { by: string; groundsHash: string; bond: string; respondentBond: string; funded: boolean; at: number; fundedAt: number; acked: boolean; ackedAt: number; appealFee?: string } | null;
  termsVersion?: number; // 2 = v4 parameterized terms stored explicitly (absent on legacy escrows)
  terms?: Terms;
  termsHash?: string;
  windowEnds: number; outcome: string | null; defaulted: boolean;
  // v5 storage accounting (absent on legacy escrows, treated as zero)
  createStorage?: string; deliverableStorage?: string;
  finalAt?: number | null; pruneConsent?: string[]; pruned?: boolean; retainedRent?: string;
};

@NearBindgen({ requireInit: true })
class Sealgate {
  owner: string = '';
  appellateExecutor: string = ''; // sole account allowed to post L1 claims (L1 redesign, 2026-11-09)
  feeSink: string = ''; // platform fee recipient (v3): 1% of the escrow amount on judgment settlements
  appellateExecutorX25519: string = ''; // executor's bundle public key, anchored on-chain (F7)
  appellateExecutorMinW1: number = 0; // executor-declared W1 range (v4, M2/S3); 0 = unset
  appellateExecutorMaxW1: number = 0;
  feeScheduleBps: number = -1; // v4 fee schedule rate; -1 = unset (legacy resolution: sink at 100 bps)
  signers: string[] = []; // "ecdsa:<address>" / "ed25519:<address>", attestation-anchored, admin-set
  nextId: number = 0;
  balances = new UnorderedMap<string>('b');
  escrows = new UnorderedMap<string>('e');
  usedReqHashes = new UnorderedMap<boolean>('u');

  // --- per-escrow encryption keys (SPEC v2: response ciphertext readable by both
  // parties). Stored inside the escrow JSON, not a new collection, so redeploying
  // this code over existing state cannot break state reconstruction. ---
  @call({})
  register_key({ escrow_id, pubkey, terms_hash }: { escrow_id: number; pubkey: string; terms_hash?: string }) {
    const e = this.load(escrow_id);
    const who = near.predecessorAccountId();
    if (who !== e.buyer && who !== e.worker) throw new Error('only a party registers a key');
    if (typeof pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('pubkey must be 32-byte hex');
    // Consent proof (S6): on a v4 escrow the worker's engagement must name
    // the terms it accepts; a provided hash is always verified.
    if (terms_hash !== undefined && terms_hash !== '' && terms_hash !== termsHashOf(e)) throw new Error('terms_hash does not match the escrow terms');
    if ((e as any).termsVersion === 2 && who === e.worker && !terms_hash) throw new Error('terms_hash is required for the worker on a v4 escrow');
    if (who === e.buyer) { if (e.buyerKey) throw new Error('buyer key already registered'); e.buyerKey = pubkey; }
    else { if (e.workerKey) throw new Error('worker key already registered'); e.workerKey = pubkey; }
    this.save(escrow_id, e);
  }

  @view({})
  get_key({ escrow_id, account }: { escrow_id: number; account: string }): string | null {
    const e = this.load(escrow_id);
    return account === e.buyer ? (e.buyerKey ?? null) : account === e.worker ? (e.workerKey ?? null) : null;
  }

  @initialize({})
  init({ owner }: { owner: string }) { this.owner = owner; }

  // --- signer registry (admin; registration is anchored to attestation reports off-chain) ---
  @call({})
  register_signer({ algo, address }: { algo: string; address: string }) {
    if (near.predecessorAccountId() !== this.owner) throw new Error('only owner registers signers');
    const key = `${algo}:${address.toLowerCase().replace(/^0x/, '')}`;
    if (!this.signers.includes(key)) this.signers.push(key);
  }

  @view({})
  get_signers(): string[] { return this.signers; }

  // --- appellate executor (owner-set): the neutral runner of the appellate
  // protocol and the ONLY account that may post an L1 claim. In production this
  // account's key lives inside an attested TEE app; here it is a dedicated
  // service account, and its signed transcript is verifiable by both parties. ---
  @call({})
  set_appellate_executor({ account, x25519_pub, min_w1_ms, max_w1_ms }: { account: string; x25519_pub?: string; min_w1_ms?: number; max_w1_ms?: number }) {
    if (near.predecessorAccountId() !== this.owner) throw new Error('only owner sets the appellate executor');
    if (x25519_pub !== undefined && x25519_pub !== '' && !/^[0-9a-f]{64}$/.test(x25519_pub)) throw new Error('x25519_pub must be 32-byte hex');
    // D4: changing the executor ACCOUNT requires the full specification.
    // Silently inheriting the old executor's bundle key or W1 range would
    // snapshot the wrong key into future escrows — and an unopenable bundle
    // is billed to the appellant by the lapse rules.
    if (account !== this.appellateExecutor && (!x25519_pub || min_w1_ms === undefined || max_w1_ms === undefined)) {
      throw new Error('changing the executor requires x25519_pub, min_w1_ms and max_w1_ms (no silent inheritance)');
    }
    if (min_w1_ms !== undefined) this.appellateExecutorMinW1 = intArg(min_w1_ms, 'min_w1_ms');
    if (max_w1_ms !== undefined) this.appellateExecutorMaxW1 = intArg(max_w1_ms, 'max_w1_ms');
    const mn = this.appellateExecutorMinW1 || 0; const mx = this.appellateExecutorMaxW1 || 0;
    if (mn > 0 && (mn < PROTOCOL_MIN_W1_MS || mn > MAX_WINDOW_MS)) throw new Error('executor min W1 out of range');
    if (mx > 0 && (mx < PROTOCOL_MIN_W1_MS || mx > MAX_WINDOW_MS)) throw new Error('executor max W1 out of range');
    if (mn > 0 && mx > 0 && mn > mx) throw new Error('executor min W1 exceeds its max W1');
    this.appellateExecutor = account;
    if (x25519_pub) this.appellateExecutorX25519 = x25519_pub;
    near.log(`appellate executor set: ${account} (W1 range ${this.appellateExecutorMinW1}..${this.appellateExecutorMaxW1} ms)`);
  }

  @view({})
  get_appellate_executor(): { account: string; x25519_pub: string; min_w1_ms: number; max_w1_ms: number } {
    return { account: this.appellateExecutor, x25519_pub: this.appellateExecutorX25519, min_w1_ms: this.appellateExecutorMinW1 || 0, max_w1_ms: this.appellateExecutorMaxW1 || 0 };
  }

  // --- platform fee sink (owner-set): receives 1% of the escrow amount on
  // every judgment settlement. Snapshot per escrow at creation, like the
  // appellate executor, so a later change never rewrites a live escrow. ---
  @call({})
  set_fee_sink({ account }: { account: string }) {
    if (near.predecessorAccountId() !== this.owner) throw new Error('only owner sets the fee sink');
    this.feeSink = account;
    near.log(`fee sink set: ${account}`);
  }

  @view({})
  get_fee_sink(): string { return this.feeSink; }

  // The fee schedule (v4, M1): the fee is the RECIPIENT's term, registered
  // by the platform as (sink, bps) and snapshotted per escrow at creation.
  // A creator never picks the rate on its own case (at 0..1000 to choose
  // from, every rational creator picks 0 — or worse, itself as sink).
  feeSchedule(): { account: string; bps: number } {
    const bps = this.feeScheduleBps;
    return { account: this.feeSink, bps: typeof bps === 'number' && bps >= 0 ? bps : 100 };
  }

  @call({})
  set_fee_schedule({ account, bps }: { account: string; bps: number }) {
    if (near.predecessorAccountId() !== this.owner) throw new Error('only owner sets the fee schedule');
    intArg(bps, 'bps');
    if (bps < 0 || bps > MAX_FEE_BPS) throw new Error('fee schedule bps out of range');
    this.feeSink = account;
    this.feeScheduleBps = bps;
    near.log(`fee schedule set: ${account} at ${bps} bps`);
  }

  @view({})
  get_fee_schedule(): { account: string; bps: number } { return this.feeSchedule(); }

  // The single escrow-payout helper (design review Q2: one fee computation,
  // shared by every settlement path). The fee comes out of the amount; the
  // recipient gets amount - fee, so the total is conserved exactly. Legacy
  // escrows (no sink snapshotted) pay no fee. Expiry never calls this.
  payEscrow(e: Escrow, outcome: string) {
    const amount = s2b(e.amount);
    const t = termsOf(e);
    const fee = feeOfTerms(t, amount);
    this.credit(outcome === 'PASS' ? e.worker! : e.buyer, amount - fee);
    if (fee > 0n) this.credit(t.feeSink!, fee);
  }

  // --- internal balances (deposit model) ---
  @call({ payableFunction: true })
  deposit() {
    const who = near.predecessorAccountId();
    const cur = this.balances.get(who, { defaultValue: '0' })!;
    this.balances.set(who, (s2b(cur) + near.attachedDeposit()).toString());
  }

  @view({})
  get_balance({ account }: { account: string }): string { return this.balances.get(account, { defaultValue: '0' })!; }

  @call({})
  withdraw({ amount }: { amount: string }) {
    const who = near.predecessorAccountId();
    const cur = s2b(this.balances.get(who, { defaultValue: '0' })!);
    const amt = s2b(amount);
    if (amt <= 0n || amt > cur) throw new Error('insufficient balance');
    this.balances.set(who, (cur - amt).toString());
    const promise = near.promiseBatchCreate(who);
    near.promiseBatchActionTransfer(promise, amt);
    return promise;
  }

  credit(who: string, amt: bigint) {
    if (amt <= 0n) return;
    const cur = this.balances.get(who, { defaultValue: '0' })!;
    this.balances.set(who, (s2b(cur) + amt).toString());
  }

  load(id: number): Escrow {
    intArg(id, 'escrow_id');
    const raw = this.escrows.get(String(id));
    if (!raw) throw new Error('no such escrow');
    return JSON.parse(raw) as Escrow;
  }
  save(id: number, e: Escrow) { this.escrows.set(String(id), JSON.stringify(e)); }

  // --- escrow lifecycle ---
  // Build + validate the v4 terms snapshot for a new escrow. The fee comes
  // from the platform's registered schedule (M1); bonds and windows are the
  // creator's, inside the constitutional bounds (hardcoded defaults apply
  // when an argument is omitted — the defaults live in code, not in owner
  // state, so they cannot drift under a live escrow: S4/M7).
  buildTerms(amount: bigint, opts: { bond_bps?: number; bond_floor?: string; w_ms?: number; w1_ms?: number }): Terms {
    // H1: the executor must have declared its W1 range; undeclared must not
    // resolve to the 5-minute protocol floor on live escrows.
    if (!(this.appellateExecutorMinW1 > 0)) throw new Error('the appellate executor has not declared a minimum W1 — v2 escrows cannot be created yet');
    const sched = this.feeSchedule();
    const t: Terms = {
      feeSink: sched.account || null, feeBps: sched.account ? sched.bps : 0,
      bondBps: opts.bond_bps !== undefined ? intArg(opts.bond_bps, 'bond_bps') : 1000,
      bondFloor: opts.bond_floor !== undefined ? amtArg(opts.bond_floor, 'bond_floor').toString() : MIN_BOND.toString(),
      wMs: opts.w_ms !== undefined ? intArg(opts.w_ms, 'w_ms') : W,
      w1Ms: opts.w1_ms !== undefined ? intArg(opts.w1_ms, 'w1_ms') : W1,
      appealFee: APPEAL_FEE.toString(),
      executorMinW1Ms: this.appellateExecutorMinW1 || 0, executorMaxW1Ms: this.appellateExecutorMaxW1 || 0,
    };
    validateTerms(t, amount, t.executorMinW1Ms, t.executorMaxW1Ms);
    return t;
  }

  @call({ payableFunction: true })
  create_escrow({ worker, amount, criteria_hash, deliver_by, settle_by, salted, case_type, bond_bps, bond_floor, w_ms, w1_ms, max_fee_bps }:
    { worker: string; amount: string; criteria_hash: string; deliver_by: number; settle_by: number; salted?: boolean; case_type?: string; bond_bps?: number; bond_floor?: string; w_ms?: number; w1_ms?: number; max_fee_bps?: number }): number {
    const buyer = near.predecessorAccountId();
    // v5: the record skeleton is funded by its creator, exactly (attached,
    // like bonds — never debited from internal balances).
    if (near.attachedDeposit() !== CREATE_STORAGE) throw new Error('create storage deposit must equal CREATE_STORAGE exactly');
    hashArg(criteria_hash, 'criteria_hash');
    intArg(deliver_by, 'deliver_by'); intArg(settle_by, 'settle_by');
    // D1: creator-side slippage protection — the schedule is read at
    // execution time, so a creator may name the most it accepts.
    if (max_fee_bps !== undefined) { intArg(max_fee_bps, 'max_fee_bps'); if (this.feeSchedule().bps > max_fee_bps) throw new Error('the fee schedule exceeds the creator max_fee_bps'); }
    if (buyer === worker) throw new Error('buyer and worker must differ');
    if (!this.appellateExecutor) throw new Error('appellate executor must be registered before creating an escrow');
    if (this.appellateExecutor === buyer || this.appellateExecutor === worker) throw new Error('appellate executor must not be a party');
    if (!this.feeSink) throw new Error('fee sink must be set before creating an escrow');
    const caseType = case_type || 'inspection';
    if (caseType !== 'inspection' && caseType !== 'adjudication') throw new Error('case_type must be inspection or adjudication');
    const amt = amtArg(amount, 'amount');
    if (amt < MIN_AMOUNT) throw new Error('amount below the protocol minimum');
    const terms = this.buildTerms(amt, { bond_bps, bond_floor, w_ms, w1_ms });
    if (settle_by <= deliver_by) throw new Error('settle_by must be after deliver_by');
    if (settle_by - deliver_by < terms.wMs + terms.w1Ms) throw new Error('window too short: settle_by - deliver_by must cover W + W1');
    if (settle_by + terms.wMs + 2 * terms.w1Ms > nowMs() + MAX_LIFETIME_MS) throw new Error('total lifetime (incl. the appeal tail) exceeds the protocol maximum');
    const bal = s2b(this.balances.get(buyer, { defaultValue: '0' })!);
    if (bal < amt) throw new Error('insufficient deposited balance');
    this.balances.set(buyer, (bal - amt).toString());
    const id = this.nextId++;
    const e: Escrow = {
      buyer, worker, amount, criteriaHash: criteria_hash, appellateExecutor: this.appellateExecutor, appellateExecutorKey: this.appellateExecutorX25519 || null, salted: !!salted, deliverableHash: null, deliverableCipher: null,
      open: false, claimBy: 0, deliverWindow: 0, settleWindow: 0, claimedAt: 0, feeSink: terms.feeSink, caseType,
      deliverBy: deliver_by, settleBy: settle_by, phase: 'Funded',
      claims: [], buyerKey: null, workerKey: null, dispute: null, windowEnds: 0, outcome: null, defaulted: false,
      termsVersion: 2, terms,
      createStorage: CREATE_STORAGE.toString(), deliverableStorage: '0', finalAt: null, pruneConsent: [], pruned: false, retainedRent: '0',
    };
    e.termsHash = termsHashOf(e);
    this.save(id, e);
    near.log(`escrow ${id} created (terms ${e.termsHash.slice(0, 12)}…)`);
    return id;
  }

  // Open job (v3 bounty market): no worker yet; anyone except the buyer and
  // the snapshotted executor may claim it. Deadlines anchor at claim time.
  // Whether the criteria are public is the buyer's off-chain choice — the
  // commitment on-chain is the same either way.
  @call({ payableFunction: true })
  create_open_escrow({ amount, criteria_hash, claim_by, deliver_window, settle_window, salted, case_type, bond_bps, bond_floor, w_ms, w1_ms, max_fee_bps }:
    { amount: string; criteria_hash: string; claim_by: number; deliver_window: number; settle_window: number; salted?: boolean; case_type?: string; bond_bps?: number; bond_floor?: string; w_ms?: number; w1_ms?: number; max_fee_bps?: number }): number {
    const buyer = near.predecessorAccountId();
    if (near.attachedDeposit() !== CREATE_STORAGE) throw new Error('create storage deposit must equal CREATE_STORAGE exactly');
    hashArg(criteria_hash, 'criteria_hash');
    intArg(claim_by, 'claim_by'); intArg(deliver_window, 'deliver_window'); intArg(settle_window, 'settle_window');
    if (max_fee_bps !== undefined) { intArg(max_fee_bps, 'max_fee_bps'); if (this.feeSchedule().bps > max_fee_bps) throw new Error('the fee schedule exceeds the creator max_fee_bps'); }
    if (claim_by <= nowMs()) throw new Error('claim_by must be in the future');
    if (!(deliver_window > 0)) throw new Error('deliver_window must be positive');
    if (!this.appellateExecutor) throw new Error('appellate executor must be registered before creating an escrow');
    if (this.appellateExecutor === buyer) throw new Error('appellate executor must not be a party');
    if (!this.feeSink) throw new Error('fee sink must be set before creating an escrow');
    const caseType = case_type || 'inspection';
    if (caseType !== 'inspection' && caseType !== 'adjudication') throw new Error('case_type must be inspection or adjudication');
    const amt = amtArg(amount, 'amount');
    if (amt < MIN_AMOUNT) throw new Error('amount below the protocol minimum');
    const terms = this.buildTerms(amt, { bond_bps, bond_floor, w_ms, w1_ms });
    if (settle_window < terms.wMs + terms.w1Ms) throw new Error('settle_window must cover W + W1');
    if (claim_by + deliver_window + settle_window + terms.wMs + 2 * terms.w1Ms > nowMs() + MAX_LIFETIME_MS) throw new Error('total lifetime (incl. the appeal tail) exceeds the protocol maximum');
    const bal = s2b(this.balances.get(buyer, { defaultValue: '0' })!);
    if (bal < amt) throw new Error('insufficient deposited balance');
    this.balances.set(buyer, (bal - amt).toString());
    const id = this.nextId++;
    const e: Escrow = {
      buyer, worker: null, amount, criteriaHash: criteria_hash, appellateExecutor: this.appellateExecutor, appellateExecutorKey: this.appellateExecutorX25519 || null, salted: !!salted, deliverableHash: null, deliverableCipher: null,
      open: true, claimBy: claim_by, deliverWindow: deliver_window, settleWindow: settle_window, claimedAt: 0, feeSink: terms.feeSink, caseType,
      deliverBy: claim_by, settleBy: claim_by + settle_window, phase: 'Funded',
      claims: [], buyerKey: null, workerKey: null, dispute: null, windowEnds: 0, outcome: null, defaulted: false,
      termsVersion: 2, terms,
      createStorage: CREATE_STORAGE.toString(), deliverableStorage: '0', finalAt: null, pruneConsent: [], pruned: false, retainedRent: '0',
    };
    e.termsHash = termsHashOf(e);
    this.save(id, e);
    near.log(`open escrow ${id} created (terms ${e.termsHash.slice(0, 12)}…)`);
    return id;
  }

  @call({})
  claim_job({ escrow_id, terms_hash }: { escrow_id: number; terms_hash?: string }) {
    const e = this.load(escrow_id);
    // Consent proof (S6/M5): claiming a job means accepting its snapshotted
    // terms; on a v4 escrow the claim must name them.
    if (terms_hash !== undefined && terms_hash !== '' && terms_hash !== termsHashOf(e)) throw new Error('terms_hash does not match the escrow terms');
    if ((e as any).termsVersion === 2 && !terms_hash) throw new Error('terms_hash is required to claim a v4 job');
    if (e.phase !== 'Funded') throw new Error(`cannot claim a job in phase ${e.phase}`);
    if (!e.open || e.worker) throw new Error('not an unclaimed open job');
    const by = near.predecessorAccountId();
    if (by === e.buyer) throw new Error('the buyer cannot claim their own job');
    if (by === e.appellateExecutor) throw new Error('the appellate executor cannot claim a job it may have to judge');
    const now = nowMs();
    if (now > e.claimBy) throw new Error('claim deadline has passed');
    // Design review M2: the buyer's response key must already exist, or the
    // worker could never submit an encrypted deliverable and the slot would
    // be consumed by a failure the buyer controls.
    if (!e.buyerKey) throw new Error('the buyer has not registered a response key for this job');
    e.worker = by;
    e.claimedAt = now;
    e.deliverBy = now + e.deliverWindow;
    e.settleBy = e.deliverBy + e.settleWindow;
    this.save(escrow_id, e);
    near.log(`escrow ${escrow_id} claimed by ${by}`);
  }

  @call({ payableFunction: true })
  submit_deliverable({ escrow_id, deliverable_hash, encrypted_deliverable }: { escrow_id: number; deliverable_hash: string; encrypted_deliverable: string }) {
    const e = this.load(escrow_id);
    if (e.phase !== 'Funded') throw new Error(`cannot deliver in phase ${e.phase}`);
    if (near.predecessorAccountId() !== e.worker) throw new Error('only the worker delivers');
    if (nowMs() > e.deliverBy) throw new Error('deliver_by has passed');
    // Data availability (round-4 review R1): the deliverable ciphertext is
    // part of the submission, so an appeal never depends on the worker
    // handing the plaintext over afterwards.
    hashArg(deliverable_hash, 'deliverable_hash');
    if (typeof encrypted_deliverable !== 'string' || !encrypted_deliverable) throw new Error('encrypted deliverable is required');
    if (encrypted_deliverable.length > 16384) throw new Error('encrypted deliverable too large');
    // v5: the worker funds the ciphertext bytes it stores, exactly (v2
    // escrows; legacy escrows predate the charge and expect no deposit).
    const wantStorage = (e as any).termsVersion === 2 ? storageChargeFor(encrypted_deliverable.length) : 0n;
    if (near.attachedDeposit() !== wantStorage) throw new Error('deliverable storage deposit must equal the per-byte charge exactly');
    e.deliverableHash = deliverable_hash;
    e.deliverableCipher = encrypted_deliverable;
    e.deliverableStorage = wantStorage.toString();
    e.phase = 'Delivered';
    this.save(escrow_id, e);
  }

  @call({ payableFunction: true })
  post_claim({ escrow_id, level, verdict, req_hash, resp_hash, signature, signing_address, signing_algo, signature_kind, encrypted_response, integrity_void }:
    { escrow_id: number; level: number; verdict: string; req_hash: string; resp_hash: string; signature: string; signing_address: string; signing_algo: string; signature_kind: string; encrypted_response: string; integrity_void: boolean }) {
    const e = this.load(escrow_id);
    const by = near.predecessorAccountId();
    if (verdict !== 'PASS' && verdict !== 'FAIL') throw new Error('verdict must be PASS or FAIL');
    hashArg(req_hash, 'req_hash'); hashArg(resp_hash, 'resp_hash');
    strArg(signature, 'signature', 1024); strArg(signing_address, 'signing_address', 128);
    strArg(signing_algo, 'signing_algo', 32); strArg(signature_kind, 'signature_kind', 64);
    // Ciphertext presence is enforced (Fable review L-1): a claim without the
    // encrypted response gives the counterparty nothing to verify against.
    if (typeof encrypted_response !== 'string' || encrypted_response.length === 0) throw new Error('encrypted_response is required');
    if (encrypted_response.length > MAX_CIPHERTEXT_LEN) throw new Error('encrypted_response too large');
    if (this.usedReqHashes.get(`${escrow_id}:${level}:${req_hash}`, { defaultValue: false })) throw new Error('req_hash already used in this escrow (replay)');
    // v5: the attached deposit carries the bond PLUS the per-byte storage
    // charge for the response ciphertext (v2 escrows). The split is exact:
    // the bond rules below apply to the remainder, unchanged.
    const storagePaid = (e as any).termsVersion === 2 ? storageChargeFor(encrypted_response.length) : 0n;
    const attached = near.attachedDeposit();
    if (attached < storagePaid) throw new Error('attached deposit does not cover the response storage charge');
    const bond = attached - storagePaid;
    const now = nowMs();
    intArg(level, 'level');
    const terms = termsOf(e);
    if (level === 0) {
      if (by !== e.buyer && by !== e.worker) throw new Error('only a party may claim');
      if (e.phase !== 'Delivered') throw new Error(`cannot post L0 claim in phase ${e.phase}`);
      if (now > e.settleBy) throw new Error('claim after settle_by');
      if (!e.buyerKey || !e.workerKey) throw new Error('both parties must register response keys before an L0 claim');
      // Exact bonds (S2): overpayment is rejected, not silently slashable.
      if (bond !== bondOf(terms, s2b(e.amount))) throw new Error('claim bond must equal B0 exactly');
    } else if (level === 1) {
      const exec = e.appellateExecutor;
      if (!exec) throw new Error('no appellate executor snapshotted on this escrow');
      if (by !== exec) throw new Error('only the appellate executor may post L1 claims');
      if (e.phase !== 'Disputed') throw new Error(`cannot post L1 claim in phase ${e.phase}`);
      if (!e.dispute!.funded) throw new Error('appeal is not fully funded');
      if (bond !== 0n) throw new Error('L1 claims carry no bond');
      if (now > (e.dispute!.fundedAt || 0) + terms.w1Ms) throw new Error('appellate claim deadline has passed');
    } else throw new Error('level must be 0 or 1');
    this.usedReqHashes.set(`${escrow_id}:${level}:${req_hash}`, true);
    e.claims.push({
      by, level, verdict, reqHash: req_hash, respHash: resp_hash, signature,
      signingAddress: signing_address, signingAlgo: signing_algo, signatureKind: signature_kind,
      encryptedResponse: encrypted_response, bond: bond.toString(),
      integrityVoid: !!integrity_void, at: now, coSignedBy: [by],
      storagePaid: storagePaid.toString(),
    });
    e.phase = 'Claimed';
    e.windowEnds = now + (level === 0 ? terms.wMs : terms.w1Ms);
    this.save(escrow_id, e);
    near.log(`escrow ${escrow_id} claim L${level} ${verdict}`);
  }

  // Appeal funding (PARAMETERS.md): the appellant posts 2xB0 atomically with the
  // dispute, within the first half of the dispute window (Kleros-style asymmetry).
  @call({ payableFunction: true })
  dispute({ escrow_id, grounds_hash }: { escrow_id: number; grounds_hash: string }) {
    hashArg(grounds_hash, 'grounds_hash');
    const e = this.load(escrow_id);
    if (e.phase !== 'Claimed') throw new Error(`cannot dispute in phase ${e.phase}`);
    const claim = e.claims[e.claims.length - 1];
    if (claim.level !== 0) throw new Error('L1 claims are final; no judgment dispute exists at L1');
    const by = near.predecessorAccountId();
    if (by === claim.by) throw new Error('the claimant cannot dispute their own claim');
    if (by !== e.buyer && by !== e.worker) throw new Error('only a party may dispute');
    const terms = termsOf(e);
    if (nowMs() > claim.at + terms.wMs / 2) throw new Error('appeal funding deadline (first half of the window) has passed');
    // One attached deposit carries the dispute bond and the appeal fee
    // (M8); the split is exact, so an over- or under-payment reverts.
    const attached = near.attachedDeposit();
    const wantBond = bondOf(terms, s2b(e.amount)) * 2n;
    const wantFee = s2b(terms.appealFee);
    if (attached !== wantBond + wantFee) throw new Error('appeal funding must equal 2xB0 + the appeal fee exactly');
    e.dispute = { by, groundsHash: grounds_hash, bond: wantBond.toString(), respondentBond: '0', funded: false, at: nowMs(), fundedAt: 0, acked: false, ackedAt: 0, appealFee: wantFee.toString() };
    e.phase = 'Disputed';
    this.save(escrow_id, e);
  }

  // Response funding: the respondent (L0 claimant) posts 1xB0 within the full window.
  // If they never fund, the appeal wins by default (see finalize).
  @call({ payableFunction: true })
  respond_dispute({ escrow_id }: { escrow_id: number }) {
    const e = this.load(escrow_id);
    if (e.phase !== 'Disputed') throw new Error(`cannot respond in phase ${e.phase}`);
    if (e.dispute!.funded) throw new Error('appeal already fully funded');
    const by = near.predecessorAccountId();
    if (by !== e.claims[0].by) throw new Error('only the L0 claimant responds');
    if (nowMs() > e.claims[0].at + termsOf(e).wMs) throw new Error('response funding deadline has passed');
    const bond = near.attachedDeposit();
    if (bond !== bondOf(termsOf(e), s2b(e.amount))) throw new Error('response funding must equal B0 exactly');
    e.dispute!.respondentBond = bond.toString();
    e.dispute!.funded = true;
    e.dispute!.fundedAt = nowMs();
    this.save(escrow_id, e);
  }

  // The executor acknowledges it accepted a verified appeal bundle. This
  // attributes a later lapse: acked + no L1 = executor silence (all bonds
  // return); never acked = the appellant did not prosecute (N3).
  @call({})
  ack_bundle({ escrow_id }: { escrow_id: number }) {
    const e = this.load(escrow_id);
    if (e.phase !== 'Disputed') throw new Error(`cannot ack in phase ${e.phase}`);
    // The ack records bundle RECEIPT and may precede respondent funding
    // (round-4 review R4). Once funded, it has a deadline (R2): no ack in
    // the second half of the L1 window.
    if (near.predecessorAccountId() !== e.appellateExecutor) throw new Error('only the snapshotted appellate executor may ack');
    if (e.dispute!.acked) return; // idempotent: a re-run must not brick itself
    if (e.dispute!.funded && nowMs() > (e.dispute!.fundedAt || 0) + termsOf(e).w1Ms / 2) throw new Error('ack deadline has passed (funding time + W1/2)');
    e.dispute!.acked = true;
    e.dispute!.ackedAt = nowMs();
    this.save(escrow_id, e);
  }

  @call({})
  co_sign({ escrow_id }: { escrow_id: number }) {
    const e = this.load(escrow_id);
    if (e.phase !== 'Claimed') throw new Error(`cannot co-sign in phase ${e.phase}`);
    const claim = e.claims[e.claims.length - 1];
    const by = near.predecessorAccountId();
    if (by !== e.buyer && by !== e.worker) throw new Error('only a party may co-sign');
    if (!claim.coSignedBy.includes(by)) claim.coSignedBy.push(by);
    if (claim.coSignedBy.includes(e.buyer) && claim.coSignedBy.includes(e.worker)) {
      this.settle(e, claim, e.claims.length > 1 ? 'decided' : 'plain');
    }
    this.save(escrow_id, e);
  }

  @call({})
  finalize({ escrow_id }: { escrow_id: number }) {
    const e = this.load(escrow_id);
    const now = nowMs();
    if (e.phase === 'Disputed') {
      if (!e.dispute!.funded) {
        if (now <= e.claims[0].at + termsOf(e).wMs) throw new Error('response funding window still open');
        this.settleDefault(e); // respondent never funded: appeal wins by default
      } else {
        if (now <= (e.dispute!.fundedAt || 0) + termsOf(e).w1Ms) throw new Error('appellate claim window still open');
        this.settle(e, e.claims[0], 'dismissed'); // funded but never prosecuted
      }
    } else if (e.phase === 'Claimed') {
      if (now <= e.windowEnds) throw new Error('window still open');
      const claim = e.claims[e.claims.length - 1];
      this.settle(e, claim, e.claims.length > 1 ? 'decided' : 'plain');
    } else throw new Error(`cannot finalize in phase ${e.phase}`);
    this.save(escrow_id, e);
  }

  // Default overturn (PARAMETERS.md): the L0 verdict flips, the appellant's funding
  // returns, and the respondent's claim bond goes to the appellant.
  // The appeal fee (M8) is the executor's price for prosecuting an appeal,
  // held apart from the bonds: it pays out only when an L1 claim posted;
  // every other ending refunds it to the appellant.
  settleAppealFee(e: Escrow, posted: boolean) {
    const fee = s2b(e.dispute?.appealFee ?? '0');
    if (fee <= 0n) return;
    this.credit(posted ? e.appellateExecutor! : e.dispute!.by, fee);
  }

  settleDefault(e: Escrow) {
    const l0 = e.claims[0];
    const negated = l0.verdict === 'PASS' ? 'FAIL' : 'PASS';
    this.payEscrow(e, negated);
    this.settleAppealFee(e, false);
    this.credit(e.dispute!.by, s2b(e.dispute!.bond));
    this.credit(e.dispute!.by, s2b(l0.bond));
    e.phase = 'Final';
    e.outcome = negated;
    e.defaulted = true;
    e.finalAt = nowMs();
    near.log(`escrow settled by default: ${negated}`);
  }

  // Credit balances per the bond-resolution rules (PARAMETERS.md §1).
  settle(e: Escrow, finalClaim: Claim, mode: string) {
    const l0 = e.claims[0];
    this.payEscrow(e, finalClaim.verdict);
    this.credit(finalClaim.by, s2b(finalClaim.bond)); // deciding claim's bond returns
    if (mode === 'decided' && e.dispute) {
      this.settleAppealFee(e, true);
      const overturned = finalClaim.verdict !== l0.verdict;
      if (finalClaim.integrityVoid || overturned) {
        this.credit(e.dispute.by, s2b(l0.bond));
        this.credit(e.dispute.by, s2b(e.dispute.respondentBond));
        this.credit(e.dispute.by, s2b(e.dispute.bond));
      } else {
        this.credit(l0.by, s2b(l0.bond));
        this.credit(l0.by, s2b(e.dispute.respondentBond));
        this.credit(l0.by, s2b(e.dispute.bond));
      }
    } else if (mode === 'dismissed' && e.dispute) {
      this.settleAppealFee(e, false);
      // Appeal lapsed with no L1. Attribution by the executor's ack (N3):
      if (e.dispute.acked) {
        // Executor accepted the bundle and stayed silent: every bond returns
        // to its own poster; the L0 verdict stands.
        this.credit(e.dispute.by, s2b(e.dispute.bond));
        this.credit(l0.by, s2b(e.dispute.respondentBond));
      } else {
        // Never acked: the appellant funded but did not prosecute. The
        // appellant's 2xB0 goes to the claimant; the response bond returns.
        this.credit(l0.by, s2b(e.dispute.bond));
        this.credit(l0.by, s2b(e.dispute.respondentBond));
      }
    }
    e.phase = 'Final';
    e.outcome = finalClaim.verdict;
    e.finalAt = nowMs();
    near.log(`escrow settled ${finalClaim.verdict} (${mode})`);
  }

  @call({})
  expire({ escrow_id }: { escrow_id: number }) {
    const e = this.load(escrow_id);
    const now = nowMs();
    if (e.phase === 'Funded' && e.open && !e.worker && now > e.claimBy) {
      // An open job nobody claimed: full refund, no fee (design review M1:
      // this branch is explicit on claimBy, not a deadline side effect).
      this.credit(e.buyer, s2b(e.amount));
      e.phase = 'Final';
      e.outcome = 'REFUND';
      e.finalAt = now;
      this.save(escrow_id, e);
      return;
    }
    if ((e.phase === 'Funded' && now > e.deliverBy) || (e.phase === 'Delivered' && now > e.settleBy)) {
      this.credit(e.buyer, s2b(e.amount));
      e.phase = 'Final';
      e.outcome = 'REFUND';
      e.finalAt = now;
      this.save(escrow_id, e);
      return;
    }
    throw new Error(`nothing expirable in phase ${e.phase}`);
  }

  // Prune a Final escrow's ciphertexts (v5 storage economics; mirror of
  // machine.mjs prune). Hashes, verdicts, signatures and the outcome stay;
  // only the bulky ciphertexts are deleted. Every storage payment returns
  // to its payer, minus RECORD_RENT retained from the creator's charge for
  // the record that remains (the retained rent is NOT credited to anyone —
  // it stays in the contract account as that record's storage cover).
  // Execution needs both parties' consent (each calls prune once) or the
  // retention delay after finality; a consent call that cannot execute yet
  // only records the consent.
  @call({})
  prune({ escrow_id }: { escrow_id: number }): { executed: boolean } {
    const e = this.load(escrow_id);
    if (e.phase !== 'Final') throw new Error(`cannot prune in phase ${e.phase}`);
    if (e.pruned) throw new Error('escrow already pruned');
    const by = near.predecessorAccountId();
    if (!Array.isArray(e.pruneConsent)) e.pruneConsent = [];
    if ((by === e.buyer || (e.worker && by === e.worker)) && !e.pruneConsent.includes(by)) e.pruneConsent.push(by);
    const buyerOk = e.pruneConsent.includes(e.buyer);
    const workerOk = !e.worker || e.pruneConsent.includes(e.worker);
    const delayed = !!e.finalAt && nowMs() >= e.finalAt + PRUNE_DELAY_MS;
    if (!(buyerOk && workerOk) && !delayed) { this.save(escrow_id, e); return { executed: false }; }
    if (e.deliverableCipher) {
      const ds = e.deliverableStorage ? s2b(e.deliverableStorage) : 0n;
      if (ds > 0n && e.worker) this.credit(e.worker, ds);
    }
    for (const c of e.claims) {
      const sp = c.storagePaid ? s2b(c.storagePaid) : 0n;
      if (sp > 0n) this.credit(c.by, sp);
      c.storagePaid = '0';
      c.encryptedResponse = '';
    }
    const cs = e.createStorage ? s2b(e.createStorage) : 0n;
    if (cs > 0n) {
      this.credit(e.buyer, cs - RECORD_RENT);
      e.retainedRent = RECORD_RENT.toString();
    }
    e.deliverableCipher = null;
    e.deliverableStorage = '0';
    e.createStorage = '0';
    e.pruned = true;
    this.save(escrow_id, e);
    near.log(`escrow ${escrow_id} pruned`);
    return { executed: true };
  }

  @view({})
  get_escrow({ escrow_id }: { escrow_id: number }): Escrow { return this.load(escrow_id); }

  @view({})
  escrow_count(): number { return this.nextId; }

  @view({})
  get_open_jobs(): any[] {
    const out: any[] = [];
    for (let i = 0; i < this.nextId; i++) {
      const e = this.load(i);
      if (e.phase === 'Funded' && e.open && !e.worker) {
        const t = termsOf(e);
        const amt = s2b(e.amount);
        out.push({
          id: i, buyer: e.buyer, amount: e.amount, criteriaHash: e.criteriaHash, claimBy: e.claimBy, deliverWindow: e.deliverWindow, settleWindow: e.settleWindow, caseType: e.caseType || 'inspection',
          // The terms a claimer accepts (M5): fee, net on PASS, bonds, windows.
          feeBps: t.feeBps, feeSink: t.feeSink, netOnPass: (amt - feeOfTerms(t, amt)).toString(),
          bondBps: t.bondBps, bondFloor: t.bondFloor, bond0: bondOf(t, amt).toString(),
          wMs: t.wMs, w1Ms: t.w1Ms, appealFee: t.appealFee, termsHash: (e as any).termsHash ?? termsHashOf(e),
        });
      }
    }
    return out;
  }
}
