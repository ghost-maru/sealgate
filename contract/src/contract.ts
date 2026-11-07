// Sealgate contract (SPEC v2) — near-sdk-js wrapper around the state machine whose
// reference logic lives in ../machine.mjs (unit-tested off-chain). Amounts are stored
// as decimal strings; all payouts credit internal balances (deposit model, SPEC v1 §2);
// `withdraw` is the only method that moves NEAR out.
import { NearBindgen, near, call, view, initialize, UnorderedMap } from 'near-sdk-js';

const NEAR = 10n ** 24n;
const MIN_BOND = 5n * 10n ** 22n; // 0.05 NEAR
const W = 3_600_000;              // L0 dispute window (ms): 1h demo default
const W1 = 1_800_000;             // L1 window (ms): 30min
const MAX_CIPHERTEXT_LEN = 2048;  // ~1KB padded ciphertext, base64

const bond0 = (amount: bigint): bigint => { const t = amount / 10n; return t > MIN_BOND ? t : MIN_BOND; };
const nowMs = (): number => Number(near.blockTimestamp() / 1_000_000n);
const s2b = (s: string): bigint => BigInt(s);

type Claim = {
  by: string; level: number; verdict: string; reqHash: string; respHash: string;
  signature: string; signingAddress: string; signingAlgo: string; signatureKind: string;
  encryptedResponse: string; bond: string; integrityVoid: boolean;
  at: number; coSignedBy: string[];
};
type Escrow = {
  buyer: string; worker: string; amount: string; criteriaHash: string;
  deliverableHash: string | null; deliverBy: number; settleBy: number;
  phase: string; claims: Claim[];
  buyerKey: string | null; workerKey: string | null;
  dispute: { by: string; groundsHash: string; bond: string; respondentBond: string; funded: boolean; at: number } | null;
  windowEnds: number; outcome: string | null; defaulted: boolean;
};

@NearBindgen({ requireInit: true })
class Sealgate {
  owner: string = '';
  signers: string[] = []; // "ecdsa:<address>" / "ed25519:<address>", attestation-anchored, admin-set
  nextId: number = 0;
  balances = new UnorderedMap<string>('b');
  escrows = new UnorderedMap<string>('e');
  usedReqHashes = new UnorderedMap<boolean>('u');

  // --- per-escrow encryption keys (SPEC v2: response ciphertext readable by both
  // parties). Stored inside the escrow JSON, not a new collection, so redeploying
  // this code over existing state cannot break state reconstruction. ---
  @call({})
  register_key({ escrow_id, pubkey }: { escrow_id: number; pubkey: string }) {
    const e = this.load(escrow_id);
    const who = near.predecessorAccountId();
    if (who !== e.buyer && who !== e.worker) throw new Error('only a party registers a key');
    if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error('pubkey must be 32-byte hex');
    if (who === e.buyer) e.buyerKey = pubkey; else e.workerKey = pubkey;
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
    const raw = this.escrows.get(String(id));
    if (!raw) throw new Error('no such escrow');
    return JSON.parse(raw) as Escrow;
  }
  save(id: number, e: Escrow) { this.escrows.set(String(id), JSON.stringify(e)); }

  // --- escrow lifecycle ---
  @call({})
  create_escrow({ worker, amount, criteria_hash, deliver_by, settle_by }:
    { worker: string; amount: string; criteria_hash: string; deliver_by: number; settle_by: number }): number {
    const buyer = near.predecessorAccountId();
    if (buyer === worker) throw new Error('buyer and worker must differ');
    const amt = s2b(amount);
    if (amt <= 0n) throw new Error('amount must be positive');
    const bal = s2b(this.balances.get(buyer, { defaultValue: '0' })!);
    if (bal < amt) throw new Error('insufficient deposited balance');
    this.balances.set(buyer, (bal - amt).toString());
    const id = this.nextId++;
    const e: Escrow = {
      buyer, worker, amount, criteriaHash: criteria_hash, deliverableHash: null,
      deliverBy: deliver_by, settleBy: settle_by, phase: 'Funded',
      claims: [], buyerKey: null, workerKey: null, dispute: null, windowEnds: 0, outcome: null, defaulted: false,
    };
    this.save(id, e);
    near.log(`escrow ${id} created`);
    return id;
  }

  @call({})
  submit_deliverable({ escrow_id, deliverable_hash }: { escrow_id: number; deliverable_hash: string }) {
    const e = this.load(escrow_id);
    if (e.phase !== 'Funded') throw new Error(`cannot deliver in phase ${e.phase}`);
    if (near.predecessorAccountId() !== e.worker) throw new Error('only the worker delivers');
    if (nowMs() > e.deliverBy) throw new Error('deliver_by has passed');
    e.deliverableHash = deliverable_hash;
    e.phase = 'Delivered';
    this.save(escrow_id, e);
  }

  @call({ payableFunction: true })
  post_claim({ escrow_id, level, verdict, req_hash, resp_hash, signature, signing_address, signing_algo, signature_kind, encrypted_response, integrity_void }:
    { escrow_id: number; level: number; verdict: string; req_hash: string; resp_hash: string; signature: string; signing_address: string; signing_algo: string; signature_kind: string; encrypted_response: string; integrity_void: boolean }) {
    const e = this.load(escrow_id);
    const by = near.predecessorAccountId();
    if (by !== e.buyer && by !== e.worker) throw new Error('only a party may claim');
    if (verdict !== 'PASS' && verdict !== 'FAIL') throw new Error('verdict must be PASS or FAIL');
    if (encrypted_response.length > MAX_CIPHERTEXT_LEN) throw new Error('encrypted_response too large');
    if (this.usedReqHashes.get(req_hash, { defaultValue: false })) throw new Error('req_hash already used (replay)');
    const bond = near.attachedDeposit();
    const now = nowMs();
    if (level === 0) {
      if (e.phase !== 'Delivered') throw new Error(`cannot post L0 claim in phase ${e.phase}`);
      if (bond < bond0(s2b(e.amount))) throw new Error('claim bond below B0');
    } else if (level === 1) {
      if (e.phase !== 'Disputed') throw new Error(`cannot post L1 claim in phase ${e.phase}`);
      if (!e.dispute!.funded) throw new Error('appeal is not fully funded');
      if (bond < bond0(s2b(e.amount))) throw new Error('appellate claim bond below B0');
      if (now > e.claims[0].at + W + W1) throw new Error('appellate claim deadline has passed');
    } else throw new Error('level must be 0 or 1');
    this.usedReqHashes.set(req_hash, true);
    e.claims.push({
      by, level, verdict, reqHash: req_hash, respHash: resp_hash, signature,
      signingAddress: signing_address, signingAlgo: signing_algo, signatureKind: signature_kind,
      encryptedResponse: encrypted_response, bond: bond.toString(),
      integrityVoid: !!integrity_void, at: now, coSignedBy: [by],
    });
    e.phase = 'Claimed';
    e.windowEnds = now + (level === 0 ? W : W1);
    this.save(escrow_id, e);
    near.log(`escrow ${escrow_id} claim L${level} ${verdict}`);
  }

  // Appeal funding (PARAMETERS.md): the appellant posts 2xB0 atomically with the
  // dispute, within the first half of the dispute window (Kleros-style asymmetry).
  @call({ payableFunction: true })
  dispute({ escrow_id, grounds_hash }: { escrow_id: number; grounds_hash: string }) {
    const e = this.load(escrow_id);
    if (e.phase !== 'Claimed') throw new Error(`cannot dispute in phase ${e.phase}`);
    const claim = e.claims[e.claims.length - 1];
    if (claim.level !== 0) throw new Error('L1 claims are final; no judgment dispute exists at L1');
    const by = near.predecessorAccountId();
    if (by === claim.by) throw new Error('the claimant cannot dispute their own claim');
    if (by !== e.buyer && by !== e.worker) throw new Error('only a party may dispute');
    if (nowMs() > claim.at + W / 2) throw new Error('appeal funding deadline (first half of the window) has passed');
    const bond = near.attachedDeposit();
    if (bond < bond0(s2b(e.amount)) * 2n) throw new Error('appeal funding below 2xB0');
    e.dispute = { by, groundsHash: grounds_hash, bond: bond.toString(), respondentBond: '0', funded: false, at: nowMs() };
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
    if (nowMs() > e.claims[0].at + W) throw new Error('response funding deadline has passed');
    const bond = near.attachedDeposit();
    if (bond < bond0(s2b(e.amount))) throw new Error('response funding below B0');
    e.dispute!.respondentBond = bond.toString();
    e.dispute!.funded = true;
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
        if (now <= e.claims[0].at + W) throw new Error('response funding window still open');
        this.settleDefault(e); // respondent never funded: appeal wins by default
      } else {
        if (now <= e.claims[0].at + W + W1) throw new Error('appellate claim window still open');
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
  settleDefault(e: Escrow) {
    const l0 = e.claims[0];
    const negated = l0.verdict === 'PASS' ? 'FAIL' : 'PASS';
    this.credit(negated === 'PASS' ? e.worker : e.buyer, s2b(e.amount));
    this.credit(e.dispute!.by, s2b(e.dispute!.bond));
    this.credit(e.dispute!.by, s2b(l0.bond));
    e.phase = 'Final';
    e.outcome = negated;
    e.defaulted = true;
    near.log(`escrow settled by default: ${negated}`);
  }

  // Credit balances per the bond-resolution rules (PARAMETERS.md §1).
  settle(e: Escrow, finalClaim: Claim, mode: string) {
    const amount = s2b(e.amount);
    const l0 = e.claims[0];
    this.credit(finalClaim.verdict === 'PASS' ? e.worker : e.buyer, amount);
    this.credit(finalClaim.by, s2b(finalClaim.bond)); // deciding claim's bond returns
    if (mode === 'decided' && e.dispute) {
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
      this.credit(l0.by, s2b(e.dispute.bond));
      this.credit(l0.by, s2b(e.dispute.respondentBond));
    }
    e.phase = 'Final';
    e.outcome = finalClaim.verdict;
    near.log(`escrow settled ${finalClaim.verdict} (${mode})`);
  }

  @call({})
  expire({ escrow_id }: { escrow_id: number }) {
    const e = this.load(escrow_id);
    const now = nowMs();
    if ((e.phase === 'Funded' && now > e.deliverBy) || (e.phase === 'Delivered' && now > e.settleBy)) {
      this.credit(e.buyer, s2b(e.amount));
      e.phase = 'Final';
      e.outcome = 'REFUND';
      this.save(escrow_id, e);
      return;
    }
    throw new Error(`nothing expirable in phase ${e.phase}`);
  }

  @view({})
  get_escrow({ escrow_id }: { escrow_id: number }): Escrow { return this.load(escrow_id); }

  @view({})
  escrow_count(): number { return this.nextId; }
}
