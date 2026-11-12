# Sealgate — SPEC v2: Private Appellate Settlement

**v4 parameterization (2026-11-10).** The fixed parameters of this spec
(bond rate/floor, windows, the 1% fee) became per-escrow terms, chosen by
the creator inside constitutional bounds hardcoded in the contract, with
the fee as a registered schedule and an appeal fee for the executor. The
mechanism below is unchanged; where a number here conflicts with
PARAMETERS.md §5, PARAMETERS.md governs. Live proofs: escrows #21/#22.

**v3 generalization (2026-11-10).** On the team lead's direction, Sealgate was
generalized from inspection escrow into a judge-AI platform: open jobs (a
bounty market), a second case type (`adjudication` — case file + submission,
for platform-decision appeals, grant milestones, and similar), and a 1%
platform fee on judgment settlements. The v2 mechanism below is unchanged and
governs both case types; the v3 parameters, attribution rules, and the design
review's must-fixes (M1–M6) live in PARAMETERS.md §4. Live proof: escrows
#18 (open job), #19 and #20 (adjudication).

Status: LOCKED direction, decided 2026-11-07 (TIK). Supersedes the settle/dispute design of
SPEC.md (v1). All v1 sections not mentioned here remain in force (accounts, deposit model,
inspection template, caps). Spike results: spike/RESULTS.md (Day 1 GO).

**Implementation status (2026-11-09 — read this first).** The shipped
implementation follows this spec's core decisions (claim-based optimistic
settlement, no publication of criteria or deliverable, deterministic
integrity stage, blind panel, clear-error standard), and four external
mechanism reviews then changed the following, which this document predates:
(1) L1 claims are posted ONLY by a registered appellate executor,
snapshotted per escrow — the party-posted L1 of §2/§5 was exploitable
(first-poster-wins) and was redesigned; (2) commitments are salted
(sha256(salt ‖ text)); (3) the deliverable's ciphertext under the parties'
shared key is part of the on-chain submission, so the appellate record
cannot be withheld, and criteria + deliverable are capped at 8 KB (not
§1's 1 KB / 4 KB); (4) lapses are attributed by the executor's on-chain
ack_bundle. Where this spec and the code disagree, README.md and
PARAMETERS.md describe the shipped behavior. (The spike/ directory
referenced below lives outside this repository; the facts it established
are summarized in README's Models section and in the test fixtures.)

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
  the appellate executor posts this outcome as the L1 claim (parties cannot post
  L1 claims; the executor is snapshotted on the escrow at creation).
- L1 claims carry no bond and a shorter window W1 = W/2. No further judgment
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
  L1 claims (appellate executor only) carry no bond.
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
   immediately; dispute; the forger's attempt to race-post its own L1 claim is
   rejected by the contract; the appellate executor's L1 claim voids the forgery
   and slashes the bond (§9, first bullet; escrows #4 under the original rules,
   #8 after the redesign). Nothing was ever revealed.
4. Judgment appeal: a borderline FAIL is appealed; the appellate model (blind-first,
   different family) upholds or overturns with its own signed reason.

## 9. Known limitations (README, stated plainly)

- **L1 posting rights were the design's sharpest hole; closed 2026-11-09 by the
  appellate-executor redesign.** Originally either party could post the appellate
  claim once an appeal was funded; the contract checked bond and timing, not
  content, and L1 claims could not be disputed — a false L1 posted first decided
  the escrow and the bonds. Now the appellant seals the record to a registered
  **appellate executor** (X25519 bundle); only the executor's account can post an
  L1 claim, enforced in the contract (escrow #8: the forger's race-post was
  rejected on-chain; the executor's VOID settled the escrow without the forger's
  cooperation). The residual trust is the executor itself: a malicious executor
  can post a false outcome, but its signed transcript is fully reproducible from
  the record both parties hold, so the misconduct is provable and the operator
  is a replaceable registry entry. The production form runs the executor as an
  attested TEE app whose key is sealed to the attested code, removing operator
  discretion; on-chain verification of a verdict-only signed response remains a
  possible additional check, not a substitute (it binds a verdict to *some*
  request, not to this escrow's committed record).
- Verdict soundness is not proven by any cryptography here (true of every design in
  this family): the system proves provenance and integrity between the parties, and
  enforces outcomes economically. It does not prove the AI judged well.
- Injection resistance is empirical (§5). Verdict shopping by re-sampling L0 privately
  is mitigated, not eliminated. Measured 2026-11-09 (`dryruns/determinism.md`):
  identical temperature-0 requests returned the identical verdict 6/6 on both
  models for a clear case, and the identical reason 6/6 at L0 — but the appellate
  model's reasons varied in phrasing (3 distinct in 6), so hosted sampling is not
  bit-deterministic and borderline cases can in principle be re-drawn. The bonds,
  the dispute path, and the replay registry are the bound, not the temperature.
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
