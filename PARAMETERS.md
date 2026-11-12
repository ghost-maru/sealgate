# Sealgate bond & window parameters — evidence and rationale

Status: **frozen for the hackathon build** (2026-11-07), except items marked OPEN.
Supersedes the bond schedule in SPEC-v2 §3 where they differ (staged appeal funding).

## 1. The schedule

Unit bond **B0 = max(10% of escrow amount, 0.05 NEAR)**.

| Step | Who posts | Amount | Deadline |
|---|---|---|---|
| L0 claim | claimant (either party) | B0 | before settle_by |
| Appeal funding | disputer (appellant) | **2 × B0** | first half of the dispute window (by claim time + W/2) |
| Response funding | claimant (respondent) | **1 × B0** | full dispute window (by claim time + W) |
| L1 (appellate) claim | appellate executor only | none | by funding time + W1 |
| Executor ack (bundle receipt) | appellate executor only | none | before funding, or by funding time + W1/2 once funded |

Windows (demo defaults): **W = 1h**, **W1 = 30min**. Production guidance in README: W = 24h, W1 = 12h.

### Defaults and resolution
- Appellant never funds → the dispute cannot be opened (funding is atomic with the dispute).
- Respondent does not fund by W (appellant funded) → **default overturn**: final verdict =
  negation of the L0 verdict; appellant's 2·B0 is returned; the claimant's B0 goes to the
  appellant; outcome recorded as DEFAULT.
- Both funded, no L1 claim by funding time + W1 → **appeal lapsed**: the L0 claim
  stands and settles; the bonds split by attribution (round-3 review N3). The executor
  acks on-chain when it accepts a verified bundle. The ack may precede the
  respondent's funding (it records bundle receipt, round-4 review R4); once
  funded, the contract rejects an ack later than funding time + W1/2 (R2),
  and the executor completes every non-AI validation — commitments, grounds
  admissibility, input sizes, key verification — BEFORE acking, so an ack
  means a prosecutable appeal was received. **Acked** (executor silence,
  outage, or pipeline failure): every bond returns to its own poster. **Never acked**
  (the appellant funded but did not prosecute): the appellant's 2·B0 goes to the
  claimant, the response B0 returns. The L1 window runs from funding time (N5).
- A VOID whose blind panel reaches no quorum (or splits) resolves by
  mechanism default: the final verdict is the **negation of the L0 verdict**
  (default-overturn semantics), backed by the L0 claim's signed material and
  disclosed in the appeal transcript. A proven forgery never wins by making
  the panel abstain.
- The deliverable's ciphertext under the parties' shared key is part of the
  submission itself (round-4 review R1), so the appellate record cannot be
  withheld: the executor recovers the deliverable from the chain. An
  unusable ciphertext is a worker-side record failure → VOID with a
  mechanism-default FAIL (no AI stage is consulted for the verdict).
- L1 decides **UPHOLD** → appellant's 2·B0 goes to the claimant; claimant's B0 + response
  B0 return; escrow pays per the L0 verdict. (The executor posts the L1 claim with no
  bond: a bond that always returns secures nothing and only obstructs execution.)
- L1 decides **OVERTURN** or the claim is **VOID** (integrity failure) → claimant's
  B0 + response B0 (2·B0 total) go to the appellant; appellant's 2·B0 returns; escrow
  pays per the final verdict (VOID: refund path per the appellate verdict recorded
  with the L1 claim).
- Appellate API cost (a few cents per run) is borne by the executor and priced
  by the appeal fee (see §5); it is not deducted from any party's settlement.

**Invariant:** once an appeal is fully funded, each side has exactly **2·B0 at risk**,
and exactly 2·B0 moves from the losing side to the winning side. The asymmetry is in
*new money and timing* (the initiator posts double, under the earlier deadline), not in
total exposure.

## 2. Why these numbers — prior art

### Kleros (production, docs.kleros.io/court/appeals)
Kleros uses exactly this structure and publishes its rationale:
- The challenging side funds **2× the appeal cost**, the winning side **1×** — "higher
  barrier discourages frivolous appeals", "lower cost to defend legitimate rulings",
  and it prevents "appeal wars".
- The challenger may fund **only during the first half** of the appeal period; the
  winner has the **whole period**.
- If only one side is fully funded, **that side wins by default**; if an appeal does
  not happen, contributions are refunded.
- The base (1×) is the *cost of the next adjudication round* (juror fees × (2n+1)
  jurors). Kleros Escrow adds the timeout rule: a party that does not pay its
  arbitration fee in time loses, and the payer is reimbursed.
Sealgate's adjudication round costs < $0.01 (an API call), so the cost-recovery base is
replaced by the deterrence unit B0; the 2:1 ratio, the split deadlines, and the default
rule are adopted unchanged.
*Precision note (added after review):* deployed Kleros arbitrables actually parametrize
this as appealCost × (1 + stakeMultiplier), and governance (KIP-34, Dec 2020) records
typical settings of winner 50% / loser 100% (totals 1.5× vs 2× cost) alongside
100% / 200% settings (2× vs 3×). KIP-34 also records that **the appeal rate was about
the same (10–15%) under both settings** — production evidence that behavior is
insensitive to the exact ratio inside this band. Sealgate's primary justification for
exactly 2 is therefore not "Kleros uses 2" but the equal-exposure invariant of §1:
given the claim bond B0 already posted, appellant new money of 2·B0 makes both sides'
total at-risk exactly 2·B0. A materially larger ratio (e.g. 5) would chill meritorious
appeals against a fallible AI judge and lock up ~70% of escrow value in bonds; a
marginally different one (2.1) is indistinguishable in effect and breaks the invariant
for no gain. Augur's dispute bonds likewise escalate by doubling per round.

### UMA Optimistic Oracle (production)
- Bonds are **symmetric** (proposer = disputer) — but UMA must also *pay its
  adjudicators* (token-holder voters) out of the losing bond; Sealgate's adjudicator is
  a near-free API, so the symmetric-pay-the-judge rationale does not bind here.
- Sizing precedent 1: Polymarket's proposal bond is a **fixed, empirically calibrated**
  amount ($750; raised from $100 after observing speculative disputes) — a pure
  anti-spam floor, like Sealgate's 0.05 NEAR floor (production guidance: set the floor
  to a few dollars — bilateral counterparties need far less than a public oracle's
  stranger-proof bond).
- Sizing precedent 2: UMA's own insurance-arbitration tutorial sets the proposer bond
  as a **percentage of the amount at stake** (`oracleBondPercentage × insuredAmount`)
  plus the adjudication final fee — the model for Sealgate's 10%-of-escrow component.

### First-principles check
A bond in Sealgate must cover: (a) adjudication cost ≈ $0.03 — negligible; (b) delay
cost of locked capital over W — negligible at these scales; (c) the counterparty's
attention cost — real for agents, priced by the floor; (d) deterrence — the binding
constraint. A *fraudulent* claim's upside is the whole escrow, which no reasonable bond
deters; that is why fraud is handled by the deterministic integrity stage (claim VOID +
slash), not by bond size. A *griefing* dispute's upside is delay plus the chance the
counterparty defaults; pricing that at 20% of escrow (2·B0) with an equal 20% at risk
for the defender makes griefing negative-EV unless the defender's default probability
is implausibly high. 10%/20% sits comfortably inside the range used in production
(UMA percentage bonds; Kleros fees routinely reach double-digit % of small disputes).

## 3. Decisions (resolved 2026-11-08, team lead approved the recommendations)
1. **Two-stage default** (FRCP 55 analog: provisional finality + 24h cure period before
   a default becomes final). **DECIDED: not in this build** — appeal defaults already
   punish absence; a cure period complicates every finalize path.
2. **Post-finality relief** (30-day reopening for key leak / verification defect /
   proven fraud, execution not stayed). **DECIDED: README future work only** — an
   on-chain reopen path undercuts the finality claim; pre-finality VOID covers fraud.
3. **Appellate panel escalation** (blind judgment ×3 samples, majority, on the L1
   model). **DECIDED: implemented** (the schedule survived E2E with margin). The blind
   stage samples the appellate model 3 times on the identical canonical request and
   takes the majority verdict; the L1 claim is backed by a sample that agrees with
   the majority. Samples that fail verdict parsing abstain; fewer than 2 valid
   samples aborts the appeal run (retryable). This is a reliability mechanism against
   single-call outliers and parse failures — the Kleros 2n+1 panel analogy in form,
   with the clear-error comparison stage unchanged.

## 4. Platform parameters (v3 generalization, 2026-11-10)

### Platform fee — 1% of the escrow amount
Every Final that follows a posted claim pays a fee of `amount / 100` (integer
division) out of the escrow amount to a fee sink snapshotted per escrow at
creation (owner-set, like the appellate executor). The judgment's recipient
gets `amount − fee`, computed in one helper shared by every settlement path
(`payEscrow` in the contract, `escrowTransfers` in the reference machine), so
the total is conserved exactly. Two deliberate exclusions:
- **Expiry refunds pay no fee.** No judgment was rendered, so nothing is
  charged; an unclaimed open job and an undelivered escrow refund in full.
- **Bonds are never touched by the fee.** It does not vary with the outcome,
  with whether an appeal happened, or with who won, so it introduces no new
  tilt into the dispute/respond decisions or the executor's incentives.
Prior art: marketplace and optimistic-oracle fees sit in the 1–3% band for
small disputes (UMA's final fee, Kleros arbitrator fees); 1% is the low end
that covers TEE inference costs (~$0.01 per judgment) with a wide margin at
escrow sizes above ~0.1 NEAR. Verified live: escrows #18/#19/#20 accrued
0.005 + 0.010 + 0.008 = 0.023 NEAR, exactly 1% of each settled amount.
Known asymmetry (disclosed in the README): because expiry is free, the fee is
in practice paid mostly by parties whose cases are actually judged — e.g. a
buyer who expects FAIL gains nothing by posting the claim themselves (the
counterparty or expiry will settle it), so winning claimants bear the fee
most often. On fault paths (VOID, default, broken-cipher FAIL) the innocent
winner still bears it; offsetting it from slashed bonds was considered and
left as future work to keep the "bonds are never touched" rule absolute.

### Open jobs
An escrow may be created with **no worker** (a public job). Parameters: a
claim deadline (`claimBy`), and deliver/settle windows that anchor at claim
time, so a job can never be claimed into a half-expired lifecycle
(`settleWindow ≥ W + W1` is enforced at creation). Rules that keep the
attribution principle intact:
- The buyer's response key must be registered before anyone may claim
  (otherwise the worker could never submit an encrypted deliverable, and a
  buyer-controlled failure would consume the worker's slot).
- The buyer and the snapshotted appellate executor may not claim.
- Unclaimed expiry refunds the buyer in full, fee-free.
There is **no claim bond** in this build: squatting (claim and never
deliver) costs the claimer nothing but gas and can lock a job for at most
its deliver window; the principal is never at risk. A refundable claim bond
(forfeited to the buyer on non-delivery) is the designed v2 mitigation.
Publication of the criteria is the buyer's off-chain choice; the claim CLI
refuses to send a claim transaction unless the published criteria and salt
rebuild the on-chain commitment and fit the size cap — bait-and-switch by
the poster is therefore detectable before the claimer commits.

### Case types
`caseType ∈ {inspection, adjudication}` is fixed on-chain at creation and
cannot change (design review M5: letting either party — or the appellant
via the bundle — select the template later would hand them a choice of
adjudication standard, a procedural defect). All stages (L0, blind panel,
comparison, integrity rebuild, receipts) use exactly the one template the
escrow was created with; there is no fallback to the other template.
- **inspection**: criteria + deliverable; PASS = every criterion met.
- **adjudication**: case file (governing terms + the question presented) +
  submission; PASS = the submission prevails under the terms. The record is
  one-sided by design — the buyer frames the case file, the counterparty's
  input is the submission — and consent to the framing is expressed by
  engagement (closed escrows) or by claiming (open jobs).

## 5. Parameterization (v4, 2026-11-10) — two layers

§§1–4 fixed every number in advance. A platform others build on cannot: a
0.05 NEAR bond is serious for a 0.5 NEAR job and noise for a 500 NEAR one.
v4 therefore makes the numbers **per-escrow terms** — but not all numbers
are equal. The design rule (design review, 2026-11-10): a parameter belongs
to the **policy layer** — freely chosen by the escrow's creator, snapshotted
at creation — only if its effects fall entirely on consenting parties AND
no value in its range can make the constitutional remedies (dispute,
integrity VOID, appellate judgment) unreachable. Everything else is
**constitutional**: hardcoded identically in both implementations,
changeable only by a new code hash.

### Policy layer (creator-chosen, snapshotted, hash-bound)

- Bond rate (`bondBps`, 1%–25%) and bond floor (0.01 NEAR up to the cap
  below); dispute window W and appeal window W1 within their bounds.
- The **fee rate is not creator-chosen** (M1). It is the platform's
  registered schedule — a (sink, bps) pair set by the owner, snapshotted per
  escrow at creation. If creators picked the rate on their own case, every
  rational creator would pick 0, or name itself the sink for a disguised
  discount. What creators get instead is **slippage protection**: `create`
  takes `max_fee_bps` and reverts if the schedule has moved above it; the
  CLI reads the schedule and pins the value it just printed. Direct API
  clients should treat `max_fee_bps` as a recommended argument (without it,
  the check is skipped — the snapshot still binds whatever was registered).
- **Consent is to a hash.** The resolved terms are serialized into a
  canonical string (`sealgate-terms2|…`) binding fee, bonds, windows, appeal
  fee, amount, lifecycle anchors and the executor's bundle key, and hashed.
  `claim_job` and the worker's `register_key` require that hash, so
  accepting an engagement means accepting *these* terms. The CLI and MCP
  print the terms at every acceptance point and enforce an operator
  acceptance policy (`SEALGATE_*` env); MCP per-call policy arguments can
  only *tighten* the server's env policy, never loosen it (diff review R1 —
  the policy exists for agents that accept without reading, so the party
  being protected must not be able to argue it away).

### Constitutional layer (hardcoded in contract + reference machine)

- **W ≥ 1h** (M3): the dispute deadline is W/2, and fraud remedies are
  non-waivable — the window must leave a realistic time to detect a forged
  claim and fund a dispute. Windows cap at 30 days.
- **W1 inside the executor's declared range**, and creation *refuses
  outright* while the executor has not declared one (H1). The executor never
  consented to judge inside an arbitrary W1, and `fundedAt` is set by the
  respondent, so a short W1 converts executor latency into appellant
  forfeiture. An earlier draft resolved an undeclared range silently to a
  5-minute protocol floor; that floor remains as the floor under any
  declaration, but undeclared now means *no v2 escrows*, fail-closed.
  Currently declared: **30 minutes .. 7 days**. The minimum is the legacy
  default W1, held there until the appellate pipeline's ack→L1 latency is
  measured; the measurement replaces it here when it lands.
- **Fee cap 1000 bps (10%)** (S9): acceptable *with* M1 + claim-time
  display/policy, because the rate is then the platform's public price, not
  a per-case surprise. The registered rate is 100 bps.
- **Bond floor cap**: `bondFloor ≤ max(0.01 NEAR, 25% of amount)` (M4). An
  uncapped floor lets a buyer set an unpayable B0, read the deliverable
  through the shared key, and take a full refund at expiry.
- **Bond rate cap 25%** (S1): at 50% the bond stops signalling seriousness
  and becomes a wealth filter.
- **Lifetime cap**: deliver/settle deadlines *plus the full appeal tail*
  ≤ 365 days (S3/N7) — a case must be able to finish its appeals inside its
  own lifetime bound. The tail is **W + 2·W1**: the dispute window after the
  last possible L0 claim, the executor's W1 to post the L1 claim after
  funding, and the W1 finality window that follows an L1 claim (an earlier
  draft counted only W + W1 and under-bounded the true latest end — Fable
  full review, L-3).
- **Strict integer validation** of every numeric argument in both layers
  (M6), and whole-second windows (S5). A string `w1Ms` previously passed
  the `<` checks and string-concatenated into `fundedAt + W1` — permanently
  locked funds.
- **Bounds live in code, not owner-settable state** (S4): an owner-moved
  bound is invisible next to a code-hash change; a bound in code is exactly
  as visible as the code itself.

### Appeal fee (M8)

Bonds do not price the executor's attention: for a Sybil pair (buyer and
worker the same person in substance) the bonds cancel, so an appeal would
cost the pair nothing while consuming a panel run. The appeal fee separates
the prices: the appellant attaches **0.01 NEAR** with the dispute funding,
released to the executor **only when an L1 claim posts**, refunded on lapse
or respondent default. It is a v2 terms constant, not per-escrow, because
it prices a protocol resource rather than the parties' risk. Disclosed
(diff review N4): the fee also pays on non-panel L1 claims (integrity VOID,
mechanism-default) — the executor did the verification work there too — and
it is not refunded when the appellant wins; it is the price of the appeal
itself, like a filing fee. An executor-declared fee (per-executor pricing)
is the designed successor, future work.

### What freedom costs — disclosures

- **Weak terms make a PASS worth less.** A receipt's VERIFIED speaks about
  the record *under its terms*: a PASS under a 1% bond and a minimum appeal
  window is weaker evidence than the same PASS under default terms.
  Receipts therefore carry the terms snapshot as context (marked unverified
  — the receipt binds the judgment, not the chain state).
- **Low bond + long windows = cheap hold-up** (N3/N7): a creator can lock a
  counterparty's time cheaply. The acceptance policy exists so the
  counterparty can refuse such terms *before* engaging.
- **Long W1 grows executor re-sampling discretion** (N7): the transcript
  records every posted sample, but re-rolls that never post are unprovable
  (a documented limitation since v2). A long W1 widens that window.
- **Tiny amounts** (N8/R9): at ≤ 0.04 NEAR the 0.01 NEAR minimum floor makes
  B0 effectively 100% of the amount (the 25% cap does not bind); between
  0.04 and 0.2 NEAR the CLI's default floor sits *at* the 25% cap. Both are
  flagged non-default on the engagement surface.

### Legacy generations (M7)

Pre-v4 escrows resolve terms from literal constants by generation — gen 0:
no sink, no fee; gen 1: sink snapshot at 100 bps; both: bonds 10% / 0.05,
W 1h, W1 30min, appeal fee 0 — computed by one function per implementation
with the constants inlined, never from owner-mutable state. A legacy
settlement therefore computes in 2027 exactly what it computed at creation.
Equivalence is yocto-exact (multiply-first-then-floor:
⌊100a/10000⌋ = ⌊a/100⌋, ⌊1000a/10000⌋ = ⌊a/10⌋).

### Breaking changes for API clients (v4)

Bonds are **exact** — an over-attached bond reverts instead of being
silently slashable (S2). `dispute` attaches 2·B0 **plus the appeal fee** in
one deposit. `claim_job` and the worker's `register_key` require the terms
hash on v2 escrows. `create`/`create_open` accept the optional terms
arguments above and refuse until the executor has declared its W1 range.

### Live verification (2026-11-10)

- Create before declaration reverted on-chain ("the appellate executor has
  not declared a minimum W1"); after `scripts/setup-v4.mjs` declared
  30min..7d and registered the 100 bps schedule, creation opened.
- **Escrow #21**: closed, bondBps 2000 / W 2h / W1 45min — L0 FAIL, worker
  dispute, buyer response, panel UPHOLD/FAIL, Final/FAIL. Settlement exact:
  buyer 1.562 → 1.957, executor +0.01 (appeal fee), sink +0.005.
- **Escrow #22**: schedule raised to 250 bps; open job created (snapshot
  250 bps), claimed — CLI and contract terms hashes agreed — settled at
  2.5% (worker +0.39, sink +0.01); schedule restored to 100 bps. A create
  pinned at `max_fee_bps` 100 reverted against the 250 schedule (D1).

## 6. Storage funding (v5, 2026-11-10) — whoever stores bytes funds them

NEAR charges state to the contract account at ~1 NEAR per 100KB
(10^19 yocto per byte), held as stake for as long as the bytes live.
Generations 0–2 ignored this: the operator funded every escrow's growth,
an undercollateralization that grows linearly with usage and was, at 24
escrows, already ~8.1 NEAR of operator stake. v5 prices storage into the
protocol instead of subsidizing it:

- **Charges (constitutional constants, exact attached deposits):**
  creation pays `CREATE_STORAGE` = 0.03 NEAR (the record skeleton: terms
  snapshot, keys, dispute record headroom); `submit_deliverable` pays
  `len(ciphertext) × 10^19` yocto (the worker's bytes); each `post_claim`
  pays `len(encrypted_response) × 10^19` on top of its bond (the
  claimant's — or, at L1, the executor's — bytes). Over- and under-payment
  revert, like the bonds (S2's exactness rule applied to storage).
- **Pruning:** after Final, `prune` deletes the deliverable ciphertext and
  the claims' response ciphertexts. The hashes, verdicts, signatures,
  bond record, terms and outcome stay on-chain permanently — a pruned
  escrow still proves what was decided and that the record matched; only
  the parties' own copies can still open it. Execution requires **both
  parties' consent** (each calls `prune` once — a party that still needs
  its on-chain recovery copy simply withholds consent) or the **retention
  delay** `PRUNE_DELAY_MS` = 7 days after finality, after which anyone may
  execute. On execution every storage payment returns to its payer, minus
  `RECORD_RENT` = 0.01 NEAR retained from the creator's charge for the
  record that remains (retained in the contract account, credited to no
  one — it is that record's storage cover, not revenue).
- **What this does not solve:** the retained minimal records still grow
  the state by ~1–2KB per escrow, covered by the retained rent at
  ~5–10× margin; the operator's stake for legacy escrows #0–#23 stays
  operator-funded (their pruning, possible any time by consent or delay,
  refunds nothing — nothing was paid — and frees the stake).

### Live verification (2026-11-10)

- **Escrow #24**: closed, default terms, amount 0.3. Creator attached
  0.03; the worker's 1,420-char deliverable ciphertext cost 0.0142 and the
  1,400-char response ciphertext 0.014. Settled Final/PASS (sink +0.003,
  now 0.044 over #18–#24). Buyer consent alone did not execute the prune;
  the worker's consent executed it: worker +0.0282, buyer +0.02 (0.03
  minus the 0.01 retained rent), all exact; contract storage usage
  822,078 → 819,269 bytes. `scripts/reproduce.mjs` asserts the pruned
  state on-chain.
