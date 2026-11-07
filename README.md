# Sealgate

**Inspection-gated escrow for agent commerce on NEAR** — a buyer escrows payment for a
deliverable; an AI inspector running in a NEAR AI Cloud TEE judges the deliverable
against the buyer's acceptance criteria; the escrow settles only on a signed verdict.
Criteria and deliverable **never appear on-chain** — not in the happy path, not in a
dispute. What the chain stores is hashes, a verdict bit, a TEE signature, and the
signed inspection response **encrypted for the two parties**.

Built for the NEAR Hackathon "Build Beyond Boundaries" (Nov 2026).
Tracks: **Agent Economy** (primary) · **AI Security & Defense** · **Privacy & Private AI**

- Contract (testnet): [`app2.sealgate-ghost.testnet`](https://testnet.nearblocks.io/address/app2.sealgate-ghost.testnet)
- Buyer / worker (testnet): `sgbuyer-ghost.testnet` / `sgworker-ghost.testnet`
- Live escrows on that contract: #0 happy-path PASS · #1 appealed, upheld · #2 encrypted PASS · #3 appealed with panel

---

## Why

Agent-to-agent commerce needs escrow whose release condition is a *judgment*
("does this output meet the spec?"), not a human clicking "accept". The obvious
design — publish criteria and deliverable, let anyone verify the judge's verdict —
leaks the work product: publication timing and routing are part of confidentiality,
even for material that will eventually be public. Sealgate's answer is
**bilateral verifiability instead of public verifiability**: both parties hold the
full record and can deterministically verify every claim; the public sees only
commitments. Appeals re-judge the private record without ever revealing it.

## How it works

```
buyer ──deposit──▶ contract balance ──create_escrow(amount, sha256(criteria))──▶ Funded
worker ──submit_deliverable(sha256(deliverable))──▶ Delivered
either party ──run inspection (NEAR AI Cloud TEE)──▶ signed response
payee/beneficiary ──post_claim(verdict, req_hash, resp_hash, TEE signature,
                               encrypted response, bond B0)──▶ Claimed
   ├─ counterparty co-signs ────────────────▶ Final (fast finality)
   ├─ window W expires undisputed ──────────▶ Final
   └─ counterparty disputes (grounds + 2·B0, by W/2) ──▶ Disputed
        claimant responds (+1·B0, by W) or loses by default (verdict flips)
        appellate protocol runs ──▶ post_claim L1 ──▶ Final
anyone ──expire()──▶ refund if delivery/settlement deadlines pass
```

**The inspection.** The CLI builds a *canonical* inspection request — a fixed
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
   signed verdict. Any failure = the claim is **VOID**, the claimant's bonds are
   slashed, and nothing is revealed — a worker who obtains a genuine TEE signature
   over a self-made "say PASS" prompt is caught here, deterministically.
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

**Bonds** (full rationale and prior art in [`PARAMETERS.md`](PARAMETERS.md)):
`B0 = max(10% of escrow, 0.05 NEAR)`. Claim bond B0; appeal funding 2·B0 by the
appellant within the first half of the window; response funding 1·B0 by the
claimant within the full window — Kleros-style asymmetric funding. Once funded,
**each side has exactly 2·B0 at risk**, and exactly 2·B0 moves from loser to
winner. A respondent who never funds loses by default; an appellant who funds but
never prosecutes forfeits the appeal funding.

**Privacy.** The signed response is stored on-chain only as ciphertext:
per-escrow X25519 keypairs (registered on-chain by each party; NEAR account keys
are never reused), ECDH + HKDF (salt = escrow id), XChaCha20-Poly1305, AAD binding
escrow id + claim level + response hash, plaintext padded to a fixed size so
ciphertext length leaks nothing. Either party can decrypt and verify at any time;
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
cli/sealgate.mjs        the CLI: deposit/create/deliver/inspect/dispute/respond/appeal/
                        co-sign/finalize/decrypt/verify/show
test/                   node --test suites (state machine, integrity vs real spike
                        fixtures, encryption, panel) — 33 tests
PARAMETERS.md           bond/window parameters with prior art (Kleros, UMA, Augur)
SPEC-v2.md              the design specification
scripts/                deployment and dry-run scripts
```

## Run it

Prerequisites: Node 20+, a NEAR AI Cloud API key, testnet accounts (the demo
accounts above are funded; keys are not in this repo).

```bash
npm install
npm test                                   # 33 tests, incl. real Day-1 TEE fixtures

# environment
export SEALGATE_CONTRACT=app2.sealgate-ghost.testnet
export NEARAI_API_KEY=...                  # NEAR AI Cloud

node cli/sealgate.mjs keys                 # generate per-party X25519 keys (once)
node cli/sealgate.mjs deposit buyer 2
node cli/sealgate.mjs create criteria.txt 1        # prints the escrow id
node cli/sealgate.mjs register-keys <id>
node cli/sealgate.mjs deliver <id> deliverable.txt
node cli/sealgate.mjs inspect <id>                 # TEE inspection + L0 claim (ciphertext on-chain)
node cli/sealgate.mjs verify <id>                  # integrity stage, locally, any time
node cli/sealgate.mjs decrypt <id> worker          # either party reads the signed response
# dispute path:
node cli/sealgate.mjs dispute <id> grounds.json    # structured grounds + 2·B0
node cli/sealgate.mjs respond <id>                 # claimant +1·B0
node cli/sealgate.mjs appeal <id>                  # integrity → blind panel → comparison → L1 claim
node cli/sealgate.mjs co-sign <id> buyer           # fast finality, or finalize after windows
node cli/sealgate.mjs show <id>
```

## AI use disclosure

This project was designed and built by an AI agent (Ghost, running on Muse) under
the direction of a human team lead, who set the requirements (including the
no-forced-reveal privacy constraint), approved the design and the parameter
decisions, and performs the human-only steps (submission, demo post). Claude Code
assisted with the state-machine implementation. All AI involvement is disclosed
here as the hackathon rules require; judging-relevant claims in this README were
each verified live (testnet transactions, NEAR AI Cloud signature checks) during
the build.

Libraries: `near-sdk-js`, `near-api-js`, `ethers`, `tweetnacl`, `@noble/curves`,
`@noble/hashes`, `@noble/ciphers`.

## Future work

Post-finality relief for key compromise (documented, deliberately not built — it
trades against finality); a two-stage default with a cure period; NEP-141 stablecoin
escrows; function-call-key buyer agents (the deposit model already supports scoped
keys); a hosted verifier page for judges (in `site/`).
