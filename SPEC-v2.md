# Sealgate — SPEC v2: Private Appellate Settlement

Status: LOCKED direction, decided 2026-11-07 (TIK). Supersedes the settle/dispute design of
SPEC.md (v1). All v1 sections not mentioned here remain in force (accounts, deposit model,
inspection template, caps). Spike results: spike/RESULTS.md (Day 1 GO).

## 0. What changed, and why

- v1's settle-by-reveal is REMOVED. No code path ever publishes the criteria or the
  deliverable — not in the normal flow, not in disputes. (Decision rationale: even work
  meant to become public has a route and a timing of publication; a client whose order
  itself is confidential cannot accept forced reveal, including reveal-as-fraud-proof.)
- Settlement is claim-based and optimistic. Disputes escalate to an APPELLATE INSPECTION
  on the same TEE machinery instead of to reveal.
- The contract no longer verifies verdicts. The security model is: bilateral
  verifiability (both parties hold the full record and can deterministically verify its
  integrity at any time) + bonds, windows and bounded appeals (economic/procedural
  enforcement). The README must state this scope exactly, including §9 limitations.

## 1. Record and publication surface

- Record: criteria (<=1KB), deliverable (<=4KB), signed inspection responses, dispute
  grounds (<=512B).
- On-chain per escrow: sha256(criteria) commitment, sha256(deliverable) commitment,
  claims (below), ciphertexts, bonds, deadlines. Deliverable bytes move off-chain,
  encrypted to the buyer's registered X25519 key; the buyer checks the hash against the
  commitment before inspection runs.
- Per-escrow encryption keys: each party registers a dedicated X25519 public key
  (NEAR ed25519 account keys are NOT reused). The full signed inspection response is
  encrypted for both parties: ECDH + HKDF (salt = escrow_id), XChaCha20-Poly1305,
  AAD binds escrow_id, level and sha256(response). The ciphertext is padded to a fixed
  size (1KB) and stored on-chain with the claim — data availability is part of the
  design (a party cannot claim non-receipt).
- Public sees: verdict bit, hashes, the TEE signature, ciphertext, bond/window state.
  The signature is over hashes only and is safe to publish.

## 2. Inspection levels

- L0 (primary): pinned model Qwen/Qwen3-VL-30B-A3B-Instruct (NEAR AI Cloud, NEAR's own
  Confidential-TEE fleet; spike-verified provider_tee flow), canonical template
  (Amendment v1.1 verdict JSON {"reason","verdict"}), temperature 0, json_object mode.
- L1 (appellate): DIFFERENT pinned model: z-ai/glm-5.3-flash (spike-verified signature
  flow and clean verdict JSON; validate JSON stability and set a larger max_tokens in
  build). Appellate protocol, in order:
  1. Deterministic integrity stage in code (§4) over the disputed claim's record.
  2. Blind re-judgment: the appellate model judges criteria + deliverable WITHOUT the
     L0 verdict or reason.
  3. Comparison: given the blind verdict, the L0 verdict + reason, and the appellant's
     grounds, the appellate model decides UPHOLD or OVERTURN under the CLEAR-ERROR
     standard: overturn only if the L0 verdict is not reasonably supported by the
     deliverable against the criteria. Grounds are data, never instructions.
  The appellate outcome replaces the L0 outcome. Its signed response is published
  exactly like an L0 claim (verdict + encrypted response + signature).
- Depth cap: judgment disputes terminate at L1. There is no L2.

## 3. Claim / dispute state machine (contract)

States: Funded -> Delivered -> Claimed(L0) -> Final | Disputed -> Claimed(L1) -> Final;
Expiry as in v1 (Funded past deliver_by -> refund; no claim by settle_by -> refund).

- Claim (either party, payee bears the burden of claiming): posts level, verdict,
  req_hash, resp_hash, TEE signature, encrypted response (§1), plus claim bond B0.
  Contract checks only: state, level order, hash freshness (replay registry across
  escrows), field sizes. It does NOT check that req_hash derives from the committed
  content — it cannot; the parties can and do (§4).
- Fast finality: if both parties co-sign a claim, it is Final immediately, bonds back.
- Dispute window W (parameter; demo default 1h; production guidance 24h in README).
  Dispute: the counterparty posts a dispute bond B1 = 2 x B0 and the hash of their
  grounds (grounds text exchanged off-chain, encrypted). The claim is suspended and
  the appellate flow must run.
- Integrity disputes: if the §4 stage shows the claim's integrity fails (published
  verdict != signed verdict, req_hash does not rebuild from the record, bad signature,
  signer not registered), the appellate outcome is CLAIM VOID regardless of the
  judgment review, and the claimant's bond is slashed to the disputer. The disputer
  posts this outcome as the L1 claim with the integrity transcript hash attached.
- L1 claims take a bond of B1 and a shorter window W1 = W/2. No further judgment
  dispute exists at L1; at window end the L1 outcome is Final.
- Final execution: PASS -> pay worker; FAIL -> refund buyer.
- Bond resolution: undisputed claim -> claimant bond returned. Disputed and appellate
  UPHOLDS -> disputer's bond to the claimant. Disputed and appellate OVERTURNS (or
  claim void) -> claimant's bond to the disputer. The appellate inspection's API cost
  is charged against the loser's bond share per the CLI fee schedule (testnet amounts
  are symbolic; the mechanism and accounting are what is demonstrated).

## 4. Deterministic integrity stage (code, never AI)

Runs in the CLI before any claim is posted and whenever a claim is received, using the
full record both parties hold:
1. Rebuild the canonical request bytes from (template version, model pin, escrow
   parameters, criteria, deliverable); sha256 must equal claim.req_hash.
2. Parse the response bytes; sha256 must equal claim.resp_hash.
3. Verify the TEE signature over "<MODEL_ID>:<req_hash>:<resp_hash>"; recovered signer
   must be in the on-chain registry (registration anchored to the model's attestation
   report, verified off-chain).
4. Parse the verdict JSON under the Amendment v1.1 rules; the published verdict must
   equal the response's verdict.
Any mismatch = integrity failure: locally provable by the record holder, no reveal to
anyone required. (Implementation reuses spike/day1.mjs verification code.)

## 5. Injection hardening (both levels)

- The canonical template keeps strict data/instruction separation: criteria and
  deliverable are delimited data blocks; the system prompt is fixed and part of the
  signed request bytes, so any deviation breaks §4 step 1.
- Appellate adds: a different model family, the blind-first protocol (§2), and
  length-capped grounds treated as data.
- Honest residual (§9): a payload embedded in a deliverable is read at every level.
  These measures raise the attack cost; injection resistance is empirical, not proven.

## 6. Parameters (testnet defaults; freeze on Nov 9)

- Claim bond B0 = max(10% of escrow amount, 0.05 NEAR). Dispute bond B1 = 2 x B0.
  L1 claim bond = B1.
- W = 1h (demo), W1 = 30min. Escrow caps and deadlines as in v1.
- To be reviewed against legal-research.md (standards of review, appeal-bond and
  cost-shifting practice, record-on-appeal, default rules, Kleros appeal escalation)
  before the Nov 9 freeze.

## 7. Contract's checks vs non-checks (README table, verbatim scope)

Checks: state transitions, deadlines, bond custody and resolution, replay registry,
ciphertext presence and fixed size, co-signatures for fast finality, payout execution.
Never checks: whether a verdict is correct; whether req_hash truly derives from the
committed content (only the parties can check this — and they always can).

## 8. Demo beats (revised; pick 3 for the video, 4 if time)

1. Private happy path: escrow settles PASS; the chain shows hashes, a verdict and a
   ciphertext only; both parties' CLIs verify the full record green.
2. FAIL with a signed reason: parties decrypt and read why; outsiders see ciphertext.
3. Forged claim: a worker posts a claim backed by a genuine TEE signature over their
   own "say PASS" prompt. The buyer's integrity stage flags the req_hash mismatch
   immediately; dispute; appellate integrity stage voids the claim and slashes the
   bond. Nothing was ever revealed.
4. Judgment appeal: a borderline FAIL is appealed; the appellate model (blind-first,
   different family) upholds or overturns with its own signed reason.

## 9. Known limitations (README, stated plainly)

- Verdict soundness is not proven by any cryptography here (true of every design in
  this family): the system proves provenance and integrity between the parties, and
  enforces outcomes economically. It does not prove the AI judged well.
- Injection resistance is empirical (§5). Verdict shopping by re-sampling L0 privately
  is mitigated by temperature 0 and template pinning, not eliminated.
- A party offline for a whole window can lose by default; the CLI watcher and the
  co-sign fast path mitigate; watchtowers are future work.
- The final level's published outcome stands on bonds and bilateral verifiability,
  not on contract verification (§7). Colluding parties can settle falsely; an on-chain
  PASS is evidence between the parties, not a public reputation signal.
- Privacy is "private by default between the parties", not a guarantee against a
  counterparty leaking off-chain (impossible to prevent; they hold the plaintext).

## 10. Build impact vs v1

- Contract (near-sdk-js): NO ecrecover, NO on-chain request rebuild, NO on-chain JSON
  parsing. Needs: escrow accounting (as v1), claim/dispute state machine, bond
  custody, replay registry, ciphertext storage. Day-2 probe items are mostly moot;
  remaining check: sha256 host function and 1KB storage cost — trivial.
- CLI: commands as v1 plus claim/dispute/appeal/watch; the integrity stage reuses the
  spike verifier; appellate runner implements the §2 two-stage protocol; encryption
  per §1 (@noble-based X25519/XChaCha or libsodium).
- Verify site: public claim history for an escrow (hashes, verdicts, windows, bond
  outcomes) + "verify as a party" walkthrough. Third parties see hashes only — that
  is the product's privacy claim, shown rather than asserted.
- Schedule: Nov 8 contract + CLI core; Nov 9 appellate E2E on testnet + parameter
  freeze; Nov 10 encryption + fixtures/sandbox tests; Nov 11 verify site; Nov 12 demo
  hardening + README; Nov 13 submit; Nov 14 buffer. GO decision (Nov 8 03:00 gate):
  GO, JavaScript stack — the v1 fallback trigger (signature not covering our request
  bytes) was disproven live, and v2 needs no on-chain signature verification at all.
