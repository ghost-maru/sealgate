# Sealgate

> **Current version: the v7 judgment kernel, in [`sealgate-v7/`](sealgate-v7/).**
> **A judge neither side controls.** The v7 kernel narrows Sealgate to five
> things — fix the record, return a TEE-signed judgment, allow one appeal,
> settle (with fair exchange when money is involved), and leave the material
> for later verification. Live on testnet at `sealgate7-ghost.testnet` with
> seven real cases judged end-to-end; see
> [`sealgate-v7/README.md`](sealgate-v7/README.md). The document below
> describes the earlier v5 escrow build, kept for reference.

**A judge-AI platform for the agent economy** — anyone can obtain a fair,
appealable judgment over a sealed record for a 1% fee, and settle money on it.

Sealgate is modeled on a court system, not on a voting oracle. Two parties
commit a record to the chain as hashes — the governing terms (or acceptance
criteria) and the material under judgment (a deliverable, an evidence pack, a
milestone report). An AI judge running in a NEAR AI Cloud TEE returns a signed
verdict; the escrow settles on it. The loser may appeal exactly once: a
deterministic **integrity stage** first checks the judgment is genuine, then a
**blind panel** of a different model family re-judges the record without
seeing the original verdict, and a comparison stage overturns only under the
**clear-error standard**. The docket (claims) is public; the evidence is
sealed — the record **never appears on-chain** (the deliverable travels as
ciphertext under the two parties' shared key, as part of the submission
itself, so an appeal can never be starved of the record). What the chain
stores is hashes, a verdict bit, a TEE signature, and the signed response
**encrypted for the two parties**.

Built for the NEAR Hackathon "Build Beyond Boundaries" (Nov 2026).
Tracks: **Agent Economy** (primary) · **AI Security & Defense** · **Privacy & Private AI**

- Contract (testnet): [`app2.sealgate-ghost.testnet`](https://testnet.nearblocks.io/address/app2.sealgate-ghost.testnet)
- Buyer / worker (testnet): `sgbuyer-ghost.testnet` / `sgworker-ghost.testnet`
- Browser verifier: <https://ghost-maru.github.io/sealgate/> — read any escrow's public claim data, run the five verification steps against a record, or decrypt a claim response as a party.
- Demo video: `video/sealgate-demo-v3.mp4` (103 seconds)

**What makes it different** — in a field of pre-payment spend-guards and public-evidence oracles:

- **Judgment after delivery, between two parties.** The money moves on whether the work met the terms, not on a spending policy checked before payment.
- **The record is sealed.** Criteria and deliverable never touch the chain; the chain holds hashes, a verdict bit, a TEE signature, and the signed response encrypted for the two parties.
- **Exactly one appeal, bounded.** Bonds and windows price the appeal, a blind panel re-judges under a clear-error standard, and then the case is final.
- **Bilateral verifiability.** Each party can deterministically re-verify every claim from data it holds, and export that proof as a portable receipt.

**Verify in about two minutes** (read-only, no account, no API key):

```
node scripts/reproduce.mjs          # deployed code hash + all escrow states + fee schedule, live (~90 s)
npm test                            # 66 unit tests
node scripts/exhaustive-check.mjs   # 5,710-state invariant check over the state machine
```

**Representative live cases** — all 25 escrows (#0–#24) are Final; the full table is under [Verification](#verification-and-reproducing):

- **#2** — encrypted PASS; both parties decrypted the judge's response from chain data alone.
- **#4** — a forged claim (a "verdict" no model ever signed), detected by the integrity stage and voided on appeal.
- **#18** — open bounty job: posted unclaimed, claimed by a second account, judged PASS, settled minus the 1% fee.
- **#19** — adjudication: a seller appealed a marketplace's payout withholding; the PASS (withholding unjustified) was upheld on appeal.
- **#21** — v4 custom terms: a full appeal under a 20% bond rate, W 2h, W1 45min, settled exactly under the snapshot.

---

## Why

Agent commerce — and increasingly, platform governance — runs on *judgments*:
"does this output meet the spec?", "was this payout withholding justified?",
"did this milestone report satisfy the grant terms?" Today those judgments are
either a human clicking "accept", an opaque platform decision with no appeal,
or a public-everything oracle design that leaks the work product: publication
timing and routing are part of confidentiality, even for material that will
eventually be public. Sealgate's answer is
**bilateral verifiability instead of public verifiability**: both parties hold
the full record and can deterministically verify every claim; the public sees only
commitments. Appeals re-judge the private record without ever revealing it.

## What you can use it for

The judgment machinery is case-agnostic: an escrow fixes a **case type** at
creation, and every stage (trial judgment, blind panel, comparison, integrity
rebuild) runs under that one template. Two types are implemented; the record
is the same shape in both — a governing text plus a submission.

- **Deliverable inspection & escrow settlement** (`inspection`) — the
  original use: a buyer escrows payment, a worker delivers, the judge checks
  the deliverable against the acceptance criteria, the money settles on the
  verdict. Escrows #0–#17 are this, including forged-claim VOIDs, tampered
  bundles refused, and two independent agent processes trading end-to-end.
- **A bounty market** (`inspection`, open jobs) — post a job with **no worker
  yet**; anyone may claim it. Whether the criteria are public is the buyer's
  choice: publish them off-chain (with the commitment salt) to attract
  claimants, or keep the job unlisted. The claim tooling refuses to claim
  unless the published criteria rebuild the on-chain commitment, so a poster
  cannot bait-and-switch. Demonstrated by escrow **#18**: posted unclaimed,
  claimed by a different account from its own record view, delivered, judged
  PASS, settled.
- **Appeals of platform and AI decisions** (`adjudication`) — the case file
  carries the governing terms and the decision under challenge; the
  submission carries the appellant's evidence. Marketplace payout
  withholdings, listing rejections, automated screening outcomes: any
  decision whose record both sides hold can be judged — and appealed —
  without publishing the record. Demonstrated by escrow **#19**: a
  marketplace withheld a seller's 1.0 NEAR payout as a "weapon replica"; the
  seller's submission (a neon-orange toy water pistol, expressly exempted by
  the platform's own §2.3) prevailed at trial, and the platform's appeal was
  upheld *for the seller* — the withholding was not justified.
- **Grant and milestone evaluation** (`adjudication`) — a funder judges a
  milestone report against the grant terms; the grantee can appeal a FAIL
  without publishing their research or business details. Demonstrated by
  escrow **#20**: the report contained one of three required elements
  (endurance results) and omitted the cost breakdown and the data-repository
  reference — judged FAIL, and the grantee's appeal (the report "was read
  too narrowly") was upheld *against* them: the elements are simply absent.
- Beyond these, the same shape fits insurance-claim assessment (medical
  evidence stays sealed), content-moderation appeals, and audit disputes —
  anywhere a consequential judgment must be **verifiable by the parties,
  private from everyone else, and appealable exactly once**. Portable
  receipts (below) let a party carry a sealed track record — "37 settlements,
  2 appeals, both upheld" — as a reputation signal that reveals nothing
  about the underlying work.

**The fee.** Judgments are not free to produce and the platform is not a
subsidy: every settlement that follows a posted claim pays the platform's
registered fee — currently **1% of the escrow amount** — to the fee sink,
out of the amount (never out of the bonds, never on an expiry refund — no
judgment, no fee). The rate is a registered schedule snapshotted per escrow
at creation, not a constant: escrow #22 was created under a 250 bps
schedule and settled at 2.5% after the schedule returned to 100 bps. Across
the seven fee-bearing demonstrations the sink accrued exactly
0.005 + 0.010 + 0.008 + 0.005 + 0.010 + 0.003 + 0.003 = **0.044 NEAR**, reproducible from
on-chain state. PARAMETERS.md §4–§5 have the rationale and the disclosed
asymmetry.

**Storage is funded by whoever stores it (v5).** On NEAR, state costs the
contract account ~1 NEAR per 100KB, forever — a platform that lets users
post ciphertexts on its account is subsidizing every case and is
undercollateralized by exactly its growth. So each storing write carries an
exact attached deposit at the protocol's own price (10^19 yocto/byte): the
creator funds the record skeleton (0.03 NEAR), the worker the deliverable
ciphertext, each claimant its response ciphertext. After finality, either
party — or anyone, after a 7-day retention delay — can **prune** the
escrow: the ciphertexts are deleted, every storage payment returns to its
payer minus a 0.01 NEAR rent retained for the minimal record (hashes,
verdicts, signatures, outcome) that stays on-chain. Escrow #24 ran the full
cycle: settled PASS, pruned by both parties' consent, refunds exact to the
yocto (worker +0.0282, buyer +0.02), storage usage 822,078 → 819,269 bytes.
PARAMETERS.md §6 has the model.

**Administration (disclosed).** On this testnet deployment the admin
surface — the model-signer registry, the appellate executor registration,
the fee schedule, and the contract's own upgrade key — sits with the
single deployer account, and the contract has no ownership-transfer
method. That is acceptable for a demonstrator and unacceptable for
mainnet: the production deployment is created under a Sputnik DAO from
genesis (council proposals for every admin operation and for code
upgrades), rather than transferred after the fact.

## How it works

```
buyer ──deposit──▶ contract balance ──create_escrow(amount, sha256(criteria))──▶ Funded
worker ──submit_deliverable(sha256(deliverable), deliverable ciphertext)──▶ Delivered
either party ──run inspection (NEAR AI Cloud TEE)──▶ signed response
payee/beneficiary ──post_claim(verdict, req_hash, resp_hash, TEE signature,
                               encrypted response, bond B0)──▶ Claimed
   ├─ counterparty co-signs ────────────────▶ Final (fast finality)
   ├─ window W expires undisputed ──────────▶ Final
   └─ counterparty disputes (grounds + 2·B0, by W/2) ──▶ Disputed
        claimant responds (+1·B0, by W) or loses by default (verdict flips)
        appellant seals the record to the appellate executor ──▶ executor runs
        the appellate protocol ──▶ executor posts L1 (parties cannot) ──▶ Final
anyone ──expire()──▶ refund if delivery/settlement deadlines pass
```

**The judgment.** An escrow's **case type** — `inspection` or `adjudication` —
is fixed on-chain at creation and selects the canonical template every stage
uses (letting any party pick the template later would hand them a choice of
adjudication standard; the design review closed that door). In `inspection`
the record is criteria + deliverable; in `adjudication` it is a case file
(governing terms + the question presented) + a submission, and PASS means the
submission prevails under the terms. The CLI builds a *canonical* request — a fixed
template binding the escrow (`ESCROW: <contract>#<id>`), the criteria, and the
deliverable, with strict data/instruction separation — and sends those exact bytes
to NEAR AI Cloud. The model's TEE signature covers
`"<MODEL>:sha256(request bytes):sha256(response bytes)"`, so the signed verdict is
bound to *this* escrow's *actual* criteria and deliverable. The verdict format is a
strict JSON object `{"reason","verdict"}` validated by a deterministic parser.

**Claims are optimistic.** The contract never verifies verdicts. It enforces state
transitions, deadlines, bond custody and resolution, replay protection, ciphertext
presence/size, and co-signatures. Truth is established by the parties' ability to
verify — see *Security model*.

**The appellate protocol** (triggered by a dispute) has three stages, in order:

1. **Integrity stage (code, not AI).** Rebuild the canonical request from the
   record; its hash must equal the claim's `req_hash`; the response hash must match;
   the TEE signature must verify and its signer must be in the on-chain registry
   anchored to the model's attestation report; the published verdict must equal the
   signed verdict. Any failure means the claim is VOID — detection here
   is deterministic — and the VOID takes effect through the L1 claim the
   appellate executor posts (next section). A worker who
   obtains a genuine TEE signature over a self-made "say PASS" prompt is caught
   here, deterministically. The verdict recorded with a VOID comes from the
   same blind panel (3 samples, majority) over the recovered record; a
   split panel in the VOID path resolves to the *negation* of the L0 verdict
   (the L0 verdict there is a proven forgery, never the tiebreak), and if
   the panel reaches no quorum at all, the mechanism default is likewise
   the negation — default-overturn semantics, backed by the L0 claim's own
   signed material and disclosed in the transcript (when the L0 response
   itself cannot be recovered, the backing is a disclosed mechanism-default
   note instead — the transcript's `l1Backing` field says which). If the record itself is
   unrecoverable — an unusable deliverable ciphertext — the mechanism
   default is FAIL, with no AI stage consulted. A detected forgery can no
   longer win by making the panel abstain.
2. **Blind re-judgment (panel).** A different model family re-judges criteria +
   deliverable *without* seeing the original verdict or reason — 3 samples,
   majority verdict; a split panel resolves to the original verdict.
3. **Comparison (clear-error standard).** The appellate model overturns only if
   the original verdict is *not reasonably supported* on the record. A blind
   disagreement alone never overturns; harmless errors never overturn. (This is
   the appellate standard of review — FRCP 52(a)(6) / AAA A-10 — transplanted
   into a prompt; see `PARAMETERS.md` and the legal research notes.)

**Disputes are pre-specified.** The appellant must state, structurally, which part
of the original reason is wrong and the error type (`MISSED_ELEMENT`,
`PHANTOM_ELEMENT`, `ADDED_REQUIREMENT`, `REASON_VERDICT_MISMATCH`, `PROCEDURAL`).
The appellate record is limited to the original record: no new deliverable, no new
arguments. Judgment disputes terminate at L1.

**Who posts the L1 claim — the appellate executor.** An earlier version of this
design let either party post the L1 claim, and the contract could not check its
content: after an appeal was funded, the first party to post decided the escrow
and the bonds. (An external concept review found this; the disclosure stayed in
this README until the fix shipped.) Since the L1 redesign, the appellant seals
the record into an X25519-encrypted bundle addressed to a registered
**appellate executor** account (`appeal.sealgate-ghost.testnet`); the executor
opens it, runs the three stages, and posts the L1 claim — and the contract
rejects L1 claims from any other account, in code. Escrow #8 replays the
escrow #4 forgery against the redesigned contract: the forger's attempt to
race-post its own L1 claim was rejected by the contract itself
(`scripts/race-l1.mjs`), the executor posted the VOID, and the escrow settled
at the window's lapse without the forger's cooperation. The executor's work is
not a black box: it records a transcript of every stage (each panel sample,
the comparison output, any integrity failures), the L1 claim it posts is
backed by the signed model response it selected, and both parties hold the
record needed to re-run every stage and check it. (The transcript file itself
is the executor's log, not a signed object — the signatures live on the model
responses it cites.) What trust remains in the executor is stated plainly
under *Not claimed*.

**Bonds** (full rationale and prior art in [`PARAMETERS.md`](PARAMETERS.md)):
`B0 = max(10% of escrow, 0.05 NEAR)` by default. Claim bond B0; appeal funding 2·B0 by the
appellant within the first half of the window; response funding 1·B0 by the
claimant within the full window — Kleros-style asymmetric funding. Once funded,
**each side has exactly 2·B0 at risk**, and exactly 2·B0 moves from loser to
winner. A respondent who never funds loses by default; an appellant who funds but
never prosecutes forfeits the appeal funding. The appellant also attaches a
0.01 NEAR **appeal fee**, released to the appellate executor only when an L1
claim actually posts (refunded on lapse or default): bonds between a Sybil
pair cancel out, so without it an appeal would cost the pair nothing while
consuming a panel run.

The default timings (W = 1h, W1 = 30 min) are demonstration timings.
**Production guidance is W = 24h and W1 = 12h**: the windows must leave a
counterparty who is offline for a full workday able to dispute, fund, and be
heard — the demo values exist so a reviewer can watch a whole lifecycle in
an afternoon, and PARAMETERS.md says so wherever they appear.

**Terms are parameters (v4).** The defaults above are defaults, not
constants. Each escrow snapshots its own **terms**: bond rate (1–25%) and
floor, dispute window W, appeal window W1, the platform fee schedule, and
the appeal fee — chosen by the creator inside **constitutional bounds**
hardcoded in the contract (W ≥ 1h so a forgery can always be disputed in
time; W1 inside the range the appellate executor *declared* it can work
in — creation refuses outright while no range is declared; fee ≤ 10%;
bond floor ≤ 25% of the amount). The resolved terms are hashed into a
canonical string binding the amount, the lifecycle anchors and the
executor's key, and claiming a job or registering as its worker requires
that hash: accepting an engagement means accepting *these* terms, which
the CLI/MCP print and check against an operator acceptance policy at every
acceptance point. Escrow #21 ran a full appeal under bond rate 20% /
W 2h / W1 45min; escrow #22 is the 250 bps fee snapshot above.
PARAMETERS.md §5 is the full two-layer design (policy vs constitutional)
with its disclosures — including that weak terms make a PASS worth less.
Breaking changes for API clients are listed there too (exact bonds;
dispute attaches 2·B0 + the appeal fee; terms hash required on claim and
worker registration).

**Privacy.** The signed response is stored on-chain only as ciphertext:
per-escrow X25519 keypairs (registered on-chain by each party; NEAR account keys
are never reused), ECDH + HKDF (salt = escrow id), XChaCha20-Poly1305, AAD binding
escrow id + claim level + response hash, plaintext padded to a fixed size per claim level so
the response ciphertext's length leaks nothing. The deliverable ciphertext
is padded to a 1 KB bucket, so its length leaks at 1 KB granularity —
approximate size, never content. The on-chain criteria/deliverable commitments
are salted (`sha256(salt ‖ text)`, salt held only in the parties' record and
inside the signed canonical request), so short or templated texts cannot be
recovered from the hashes by guessing. Either party can decrypt and verify at any time;
nobody else can read it.

## Models (pinned, spike-verified for `provider_tee` signatures)

| Role | Model |
|---|---|
| L0 inspection | `Qwen/Qwen3-VL-30B-A3B-Instruct` |
| L1 blind + comparison | `z-ai/glm-5.3-flash` |

Only NEAR AI Cloud *Confidential (TEE)* models provide model-level signature
verification; both pins were verified live against the attestation + signature
endpoints before any contract code was written.

## Security model — what is and is not claimed

**Established by construction:**
- A claim's signed response is bound to this escrow's criteria and deliverable
  (request reconstruction + TEE signature over the exact bytes).
- The signer is a genuine TEE instance of the pinned model (attestation-anchored
  registry).
- The published verdict equals the signed verdict; the response both parties hold
  is the response that was signed (hash binding + AEAD).
- Bonds, windows, defaults, and replay protection are enforced by the contract.

**Not claimed (read this before trusting it with real money):**
- **The appellate executor is a trust point.** Only the executor registered
  for an escrow (snapshotted at creation; mid-appeal replacement cannot
  redirect an existing escrow) can post its L1 claim — escrow #8 shows a
  party's race-post being rejected by the contract. A malicious or
  compromised executor could still post a false outcome, or stay silent.
  What the parties get is *detection*, not prevention, and only in part: a
  posted outcome that contradicts the record is provable misconduct (the
  L1 claim is backed by a signed blind response both parties can decrypt,
  the transcript records every panel sample and the comparison output, and
  both parties hold the record needed to re-run every stage — the
  unselected samples are recorded by chat id only, and the comparison
  response's signed bytes are not published), but **silence
  leaves no evidence, and on borderline records the executor can re-sample
  the non-deterministic hosted models until a sample suits it — neither is
  provable**. What silence can no longer do is hide behind the appellant:
  the executor acks on-chain when it accepts a verified bundle, so a funded
  appeal that lapses splits by attribution — acked (executor's silence)
  returns every bond and the L0 outcome stands; never acked means the
  appellant funded but did not prosecute, and their 2·B0 goes to the
  claimant. **That attribution covers silence after the ack.** Silence or
  outage before it — including a bundle the executor never receives — remains
  the appellant's burden, because no protocol message proves delivery of an
  off-chain bundle; the mitigations are that the ack may be recorded before
  the respondent funds, and the contract rejects an ack recorded in the
  second half of the L1 window, so a last-minute bundle cannot buy an acked
  lapse. A claimant also cannot make its own claim unappealable: a
  response that cannot be decrypted with the parties' registered keys is
  voided as a claimant-side record failure (escrow #12), it does not lapse
  into a win. Attribution follows who controls the input — criteria: the
  buyer; the deliverable ciphertext: the worker; the L0 ciphertext and keys:
  the claimant; the bundle: the appellant — so a worker who submits an
  unusable deliverable ciphertext and then appeals *its own* submission is
  refused before the ack and forfeits the appeal funding, and an oversized
  criteria (over the 8 KB cap the CLI enforces at creation, at engagement
  acceptance, and at delivery) can no longer make an escrow unappealable
  from the specification side. When both parties are at fault, the
  appellant's own defective input is decided first — an appellant cannot
  found an appeal on their own broken submission, even against a forged
  claim. The same holds for the deliverable itself: its ciphertext is
  part of the on-chain submission, the executor recovers the record from the
  chain rather than from anything the worker hands over later, and an
  unusable ciphertext is a worker-side record failure — VOID with a
  mechanism-default FAIL (escrow #14). The production form removes the operator's discretion
  entirely: the executor runs as an attested TEE app whose key is sealed to
  the attested code (SPEC §9). In this demo it is a dedicated service
  account — the mechanism (posting rights, sealed record handoff verified
  against on-chain commitments, verifiable transcript) is the real one;
  the TEE housing is the remaining step.
- **A record the appellate model cannot judge within its token budget
  leaves a genuine L0 standing.** On a judged (non-forgery) appeal whose
  blind panel reaches no quorum, the executor re-runs inside the window; a
  record engineered to exhaust the budget ends in an acked lapse — bonds
  return, the signed L0 stands. Forged claims get no such shelter: the
  VOID path's mechanism defaults (above) need no AI quorum.
- **A mechanism-default L1 does not verify as a TEE signature.** When an
  L1 claim is backed by the mechanism default (`l1Backing: l0-material` or
  `mechanism-note` in the appeal transcript), `verify` reports it as an
  integrity failure — by design: that settlement rests on the disclosed
  default rule, not on a model signature. Read the transcript before
  co-signing such an escrow.
- **Administration is centralized in this deployment.** The contract is
  upgradeable by its deployer account key, and the signer registry and the
  executor assignment are owner-administered (additions and changes are
  visible on-chain; per-escrow executor snapshots limit their reach).
  Parties should pin the signer-registry snapshot — portable receipts carry
  one — rather than trusting the live registry blindly.
- **Storage is not charged.** Escrow records and ciphertexts persist on
  chain at the contract's expense. On testnet this is funded for the
  judging period; on mainnet, unpriced state growth is a griefing surface
  and storage metering is required work, not an optimization.
- **Verdict soundness is never proven.** A TEE signature proves *which model said
  what about which inputs*, not that the judgment is right. Correctness rests on
  the appellate protocol, bonds, and the parties' own verification.
- **Prompt-injection resistance is empirical.** Data/instruction separation,
  a different appellate model family, blind-first review, and length-capped
  grounds mitigate it; a payload embedded in a deliverable is still read at every
  level.
- **Offline through a window = loss by default.** An agent that cannot respond
  within W forfeits, as in the legal systems this mirrors.
- **The final level stands on bonds + bilateral verifiability**, not on a proof.
- **Collusion is undetectable.** A PASS both parties accept settles; an on-chain
  PASS is evidence between the parties, not a public reputation signal.
- **Privacy is "private by default".** A counterparty can always leak the record
  off-chain; the protocol guarantees the *chain* never forces disclosure.
- **Open jobs have no claim bond (v3).** Anyone may claim a public job for the
  cost of gas and lock it for at most its deliver window by never delivering;
  the principal is never at risk and expiry refunds the buyer in full, but the
  delay is real and repeatable with fresh accounts. Do not start work before
  your claim is on-chain (a front-run or the buyer's own alt-claim can take
  the slot). Settlement counts are likewise Sybil-able, so on-chain PASS
  counts are not a reputation signal. A refundable claim bond is future work.
- **A published job's criteria are not confidential.** Publication is the
  buyer's choice for that escrow; the deliverable, the judgment, and the
  responses stay sealed exactly as in a closed escrow.
- **The platform fee's incidence is asymmetric (v3).** Expiry is free, so the
  1% is borne in practice by parties whose cases are actually judged — most
  often the winning claimant — including on fault paths (a VOID or a
  broken-cipher FAIL), where the innocent winner still pays it. Bonds are
  never touched by the fee; offsetting it from slashed bonds is future work.
- **Adjudication records are one-sided by design (v3).** The buyer writes the
  case file (terms + question); the counterparty's only record input is the
  submission. Whoever frames the question holds real power, mitigated only by
  consent: the framing is committed on-chain before any work, and the
  counterparty accepts it explicitly (engagement, or claiming an open job)
  with the case type displayed. The escrow's case type itself is public
  metadata — the chain reveals that a case is an adjudication, never its
  contents.

## Repository layout

```
contract/machine.mjs    pure escrow/claim/dispute state machine (reference logic, unit-tested)
contract/src/contract.ts  near-sdk-js contract deployed on testnet (mirrors machine.mjs)
shared/templates.mjs    canonical request builders (byte-exact), grounds validation
shared/verify.mjs       the deterministic integrity stage
shared/encrypt.mjs      per-escrow response encryption (X25519/HKDF/XChaCha20-Poly1305)
cli/ai.mjs              NEAR AI Cloud calls with full attestation+signature verification
cli/appellate.mjs       the appellate protocol runner (integrity → panel → comparison)
cli/chain.mjs           testnet account/contract access
cli/sealgate.mjs        the CLI: deposit/create/create-open/claim-job/deliver/inspect/
                        dispute/respond/appeal/co-sign/finalize/decrypt/verify/show/
                        receipt/verify-receipt
shared/receipt.mjs      portable claim receipts: build + offline verification
mcp/                    MCP server exposing the CLI as 17 agent tools (see mcp/README.md)
test/                   node --test suites (state machine, terms + fixed-vector
                        hashes, integrity vs real spike fixtures, encryption,
                        panel, receipts) — 71 tests
docs/                   the browser verifier (GitHub Pages), built from site/ by site/build.mjs
demo/                   demo fixtures, the attack walkthrough (demo/attack/), and the
                        two-independent-agents demo (demo/two-agents/)
records/ transcripts/   the parties' records and executor transcripts for escrows #0–#24
demo/market/ demo/cases/  the v3 demonstration inputs (open-job criteria and a
                        worker's own record view; the two adjudication case files)
video/                  the demo video and its generator (make_v3.py)
PARAMETERS.md           bond/window parameters with prior art (Kleros, UMA, Augur)
SPEC-v2.md              the design specification (see its implementation-status note)
scripts/reproduce.mjs   one-command judge reproduction: code hash, every escrow
                        state (#0–#24), signer/executor anchors, fee totals
scripts/exhaustive-check.mjs  exhaustive state-space check of the reference machine
scripts/redeploy2.mjs   redeploy the contract WITHOUT re-initializing state
scripts/                attack simulations (forge-claim, garbage-claim, race-l1,
                        tamper-bundle, shift-salt-bundle) and one-time setup scripts
                        (deploy, deploy2, setup-executor — historical, do not re-run)
```

## Run it

**Verify first (no API key, no account — read-only, ~90 seconds):**

```bash
npm install
node scripts/reproduce.mjs   # checks the deployed contract against this repo, live
```

It confirms that the deployed contract's code hash equals `build/sealgate.wasm`
in this repo (the build is deterministic — rebuilding from `contract/src`
with `./node_modules/.bin/near-sdk-js build contract/src/contract.ts build/sealgate.wasm`
reproduces the same hash), re-runs the full integrity + response-binding
verification of the demo escrow (#2), confirms that escrow #4's forged claim
*fails* the same check while its on-chain appellate claim carries
`integrityVoid`, matches the final state and outcome of every escrow #0–#24
against the table below, and checks that the platform fees implied by the
escrows' terms equal the fee sink's on-chain balance exactly. Expected output
ends with `ALL CHECKS PASSED`.

To see a check fail in the browser verifier: open it, load escrow #2, change
any single character of the sample deliverable, and press **Verify** — step 1
(request binding) fails, because the rebuilt request no longer hashes to the
signed claim. That is the same check that detected escrow #4's forged claim
(see [`demo/attack/`](demo/attack/)).

| Verification surface | Result |
| --- | --- |
| Unit tests (`npm test`) | 66/66 — state machine (incl. open jobs, claim anchoring, fee splits), terms resolution and bounds (legacy-generation equivalence, custom-terms lifecycle, appeal-fee routing), fixed-vector terms hashes reproduced from live escrows #21/#22, integrity stage, encryption envelope, panel logic, receipts, incl. real Day-1 TEE fixtures (vendored in `test/fixtures/`, so a fresh clone runs green) |
| On-chain E2E (testnet) | 25 escrows, every settlement reconciled to the bond table (the v3 escrows also to the 1% fee; the v4 escrows to their snapshotted terms): #0 co-signed PASS · #1 appeal UPHOLD · #2 encrypted PASS · #3 panel appeal UPHOLD · #4 forged claim detected, voided via L1 · #5 full flow driven through the MCP server · #6 salted commitments, judgment task PASS · #7 appeal on realistic input UPHOLD (appellant's 2·B0 to the claimant) · #8 forgery replayed post-redesign: party race-post rejected by the contract, executor-posted VOID · #9 two independent agent processes with sealed handoffs, PASS · #10 forgery replayed after the round-2 fixes: the executor refused a tampered bundle off-chain and voided the forged claim from the verified record · #11 salt-shifted bundle refused, forgery voided · #12 wrong-secret bundle refused; garbage undecryptable claim voided as a claimant-side failure (it can no longer win by lapse) · #13 properly-encrypted forgery voided on the req_hash integrity failure, executor ack on-chain · #14 garbage on-chain deliverable ciphertext (record withheld) voided as a worker-side record failure — VOID/FAIL, forger loses 2·B0 · #15 properly-encrypted forgery voided on the req_hash integrity failure, the deliverable recovered from the on-chain ciphertext and judged PASS by the blind panel · #16 the two-independent-agents demo re-run end-to-end after the round-4 changes (deliverable ciphertext submitted on-chain by the worker process), PASS · #17 the worker submitted a garbage deliverable ciphertext and appealed its own submission against the buyer's honest FAIL — the executor refused before the ack, the appeal lapsed unacked (worker's 2·B0 to the buyer), FAIL stands · #18 open job posted unclaimed, claimed by the worker, judged PASS, settled 0.495 to the worker + 0.005 platform fee · #19 adjudication (marketplace payout-withholding appeal): seller's submission prevails at L0, the platform's own appeal is UPHELD for the seller, settled 0.99 + 0.01 fee · #20 adjudication (grant milestone): report missing two of three required elements judged FAIL, the grantee's appeal UPHELD against them, 0.792 refunded + 0.008 fee · #21 v4 non-default terms (bond 20%, W 2h, W1 45min): FAIL upheld on appeal, settlement exact, appeal fee 0.01 to the executor · #22 v4 open job under a 250 bps fee schedule: PASS, settled at 2.5% (worker +0.39, sink +0.01), schedule restored to 100 bps · #23 first escrow on the Fable-review-hardened build: a malformed criteria hash was rejected at creation, a compliant deliverable was judged PASS and co-signed, settled exact (worker +0.297, sink +0.003) · #24 v5 storage-economics proof: every stored byte funded by its writer at the protocol price, settled PASS, then pruned by both parties' consent — refunds exact (worker +0.0282, buyer +0.02), 0.01 retained as record rent, ciphertexts deleted while hashes, verdict and outcome remain |
| Portable receipts | escrow #2's receipt verifies (`VERIFIED`, including the live-registry signer check); a one-character tamper, escrow #4's forged claim, and a self-signed forged receipt all return `NOT VERIFIED` |
| Exhaustive state-space check | `node scripts/exhaustive-check.mjs` — 5,710 reachable states explored across 5 parameter regimes (two legacy generations; v4 at fee 0 / floor branch, at the fee cap with 25% bonds, and at the minimum amount where B0 == amount) under adversarial action orderings; conservation, single-disbursement, bond-PnL, ack and appeal-fee-routing invariants ALL HELD |
| MCP server | `node mcp/smoke.mjs` — 17 tools listed; show/verify checks pass; escrow #5 ran end-to-end through MCP tool calls only |
| Deployed code | `app2.sealgate-ghost.testnet` code hash `H8rAdtiL…TG2q22` == sha256 of `build/sealgate.wasm` (checked by `scripts/reproduce.mjs`); the source rebuilds to the identical hash |
| Browser verifier | all 5 checks pass against escrow #2's live on-chain record; party decryption of the same ciphertext is exercised by the CLI `decrypt` command (the site's decrypt path uses only browser-standard APIs) |

Prerequisites for the full flow: Node 20+, a NEAR AI Cloud API key, testnet accounts (the demo
accounts above are funded; keys are not in this repo).

```bash
npm install
npm test                                   # 71 tests, incl. real Day-1 TEE fixtures

# environment
export SEALGATE_CONTRACT=app2.sealgate-ghost.testnet
export NEARAI_API_KEY=...                  # NEAR AI Cloud

node cli/sealgate.mjs keys                 # generate per-party X25519 keys (once)
node cli/sealgate.mjs deposit buyer 2
node cli/sealgate.mjs create criteria.txt 1        # prints the escrow id (add: adjudication
                                                   #  as a last argument for a case file)
node cli/sealgate.mjs register-keys <id>
# open job (bounty) path:
node cli/sealgate.mjs create-open job.txt 0.5 24 24 48   # claim/deliver/settle hours;
                                                   # prints the publication salt
node cli/sealgate.mjs claim-job <id> job.txt <salt>      # as the worker: verifies the
                                                   # published criteria against the
                                                   # on-chain commitment, then claims
node cli/sealgate.mjs deliver <id> deliverable.txt
node cli/sealgate.mjs inspect <id>                 # TEE inspection + L0 claim (ciphertext on-chain)
node cli/sealgate.mjs verify <id>                  # integrity stage, locally, any time
node cli/sealgate.mjs decrypt <id> worker          # either party reads the signed response
# dispute path:
node cli/sealgate.mjs dispute <id> grounds.json    # structured grounds + 2·B0 + appeal fee
node cli/sealgate.mjs respond <id>                 # claimant +1·B0
node cli/sealgate.mjs appeal-prepare <id>          # appellant: seal the record into a bundle
node cli/sealgate.mjs appeal <id> bundles/<id>.json  # executor: integrity → panel → comparison → L1 claim
node cli/sealgate.mjs co-sign <id> buyer           # fast finality, or finalize after windows
node cli/sealgate.mjs show <id>
```

## Agent interface (MCP)

Sealgate's users are agents hiring agents, so the CLI is also exposed as a
Model Context Protocol server: 17 tools (`sealgate_create`, `sealgate_create_open`, `sealgate_open_jobs`, `sealgate_claim_job`, `sealgate_inspect`,
`sealgate_dispute`, `sealgate_verify`, …) that wrap the CLI one-to-one — no
separate protocol logic. Any MCP client can drive a full escrow: escrow #5 on
the demo contract was created, inspected, settled, and receipt-verified
through MCP tool calls only. See [`mcp/README.md`](mcp/README.md) for setup,
the tool table, and the security note (write tools operate the demo testnet
accounts from local key files that are not in this repo). Smoke test:
`node mcp/smoke.mjs`.

## Portable claim receipts

`node cli/sealgate.mjs receipt <id>` exports a single JSON receipt — the
record, the on-chain claims, a signer-registry snapshot, and the signed
response bytes. Anyone holding it can run
`node cli/sealgate.mjs verify-receipt <file>` and get a one-word answer:
`VERIFIED`, or `NOT VERIFIED` with the failing check named. Verification is
two-stage: a cryptographic check of the signed response against the record,
then — by default — a **live check that the claim's signer is in the
contract's current on-chain signer registry**. The second stage matters:
the registry embedded in a receipt is self-asserted, so an offline-only
check proves only internal consistency (anyone can mint a receipt signed by
their own key and list themselves); `--offline` keeps that weaker meaning
and prints a warning saying so. Sample
receipts live in [`receipts/`](receipts/): escrow #2 verifies; escrow #4's
receipt — built on a genuinely signed but forged claim — does not. A receipt
contains the record, so sharing one is the parties' own choice; the protocol
itself never requires it. Scope, stated plainly: `VERIFIED` means
*this signed response was really produced by a registry-anchored TEE signer
over this record* — it is **not** proof that an escrow settled that way;
settlement is what the contract state (and `scripts/reproduce.mjs`)
attests. It also speaks about
the record *under its terms*: since v4 a receipt carries the escrow's terms
snapshot as (unverified) context, because a PASS accepted under a 1% bond
and a minimum appeal window is weaker evidence than the same PASS under
default terms.

## AI use disclosure

This project was designed and built by an AI agent (Ghost, running on Muse) under
the direction of a human team lead. AI involvement covers, in full: the
protocol design and specification, the contract / state machine / CLI / MCP /
verifier-site implementation, the unit tests and the exhaustive state-space
checker, the documentation (including this README), the demo video
(frame-rendered by script), and the security review process — repeated
adversarial mechanism reviews and diff reviews by Claude (Opus) via Claude
Code, plus one full independent review by Claude (Fable), whose findings were
fixed and re-verified before submission. The human team lead set the
requirements (including the no-forced-reveal privacy constraint), made the
design and parameter decisions the agent escalated, holds the accounts and
keys, and performs the human-only steps (submission, demo post). All AI
involvement is disclosed here as the hackathon rules require;
judging-relevant claims in this README were each verified live (testnet
transactions, NEAR AI Cloud signature checks) during the build.

Libraries: `near-sdk-js`, `near-api-js`, `ethers`, `tweetnacl`, `@noble/curves`,
`@noble/hashes`, `@noble/ciphers`.

License: all rights reserved — see [`LICENSE`](LICENSE). The repository is
public so judges and anyone else can read, build, and reproduce everything
above; no reuse license is granted by publication.

## Future work

Post-finality relief for key compromise (documented, deliberately not built — it
trades against finality); a two-stage default with a cure period; NEP-141 stablecoin
escrows; function-call-key buyer agents (the deposit model already supports scoped
keys). From the v3 generalization:
a refundable **claim bond** for open jobs (forfeited to the buyer on non-delivery)
to price squatting; a **remand** outcome at L1 (send the case back for one
re-judgment, the third appellate disposition courts have and Sealgate lacks);
a public **precedent index** — appeal outcomes and grounds types only, records
still sealed — so first-instance behavior becomes predictable; and offsetting the
platform fee from slashed bonds on fault paths instead of charging the innocent
winner.
