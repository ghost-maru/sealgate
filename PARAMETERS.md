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
| L1 (appellate) claim | either party | B0 | by claim time + W + W1 |

Windows (demo defaults): **W = 1h**, **W1 = 30min**. Production guidance in README: W = 24h.

### Defaults and resolution
- Appellant never funds → the dispute cannot be opened (funding is atomic with the dispute).
- Respondent does not fund by W (appellant funded) → **default overturn**: final verdict =
  negation of the L0 verdict; appellant's 2·B0 is returned; the claimant's B0 goes to the
  appellant; outcome recorded as DEFAULT.
- Both funded, no L1 claim by claim time + W + W1 → **appeal dismissed**: the L0 claim
  stands and settles; appellant's 2·B0 goes to the claimant; respondent's B0 returns.
- L1 decides **UPHOLD** → appellant's 2·B0 goes to the claimant; claimant's B0 + response
  B0 return; the L1 claim bond returns to its poster; escrow pays per the L0 verdict.
- L1 decides **OVERTURN** or the claim is **VOID** (integrity failure) → claimant's
  B0 + response B0 (2·B0 total) go to the appellant; appellant's 2·B0 returns; the L1
  claim bond returns to its poster; escrow pays per the final verdict (VOID: refund path
  per the appellate verdict recorded with the L1 claim).
- Appellate API cost (a few cents) is charged against the losing side's transferred
  amount per the CLI fee schedule — symbolic on testnet.

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
