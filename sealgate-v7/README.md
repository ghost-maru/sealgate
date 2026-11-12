# Sealgate

**A judge neither side controls.**

Sealgate provides a neutral AI judge to parties who do not trust each
other — the same sealed record for both sides, a signed verdict both can
verify, and one fair appeal.

When agents hire agents, someone has to judge whether the delivered work
meets the criteria. If the buyer judges, the criteria can be written as a
trap: read the work, declare FAIL, keep the refund. If the seller judges,
it is not a judgment at all. Sealgate moves the judgment to a third party
that neither side controls — and then makes that judge's fairness a
matter of procedure, not of trust.

## Why both sides can trust the judge

1. **The same record.** Criteria and submission are committed as salted
   hashes and ciphertext before anyone judges. The plaintext never
   touches the chain, and no second version of the record can be shown
   to the judge.
2. **A judge pinned in advance.** The clerk, its model, and its fees are
   snapshotted into the case at creation. Nobody can swap the judge, or
   its terms, mid-case.
3. **A verifiable verdict.** Every verdict is signed inside a TEE and
   can be checked against the on-chain registry: who judged what, on
   which record. If the judge stays silent past its deadline, that
   silence is on the record too — and anyone can force the case to
   close.
4. **Equal parties.** The submitter reads the criteria before working
   and can pre-try the very same judgment locally. Both parties read the
   identical signed reason. An appeal is symmetric — equal bonds — and
   is re-judged blind: a different model family, never shown the first
   verdict, overturning only for a clear error.

The judge posts the verdict. It never moves the money: settlement
follows the verdict by the contract's rules. Underneath sits one
guarantee that protects the judgment itself — the payment transaction
carries the release key, so a FAIL verdict can never be used to read the
delivered work for free.

## What Sealgate is — and is not

Sealgate is a judgment kernel: for a single case it does exactly five
things — fix the record, return a signed judgment, allow one appeal,
settle (with fair exchange when money is involved), and leave the
material for later verification. Collecting submissions, screening spam,
ranking, and distributing prizes are the caller's work, built outside
the kernel. That narrowness is part of the fairness: the judge holds no
other power.

The specification is `SPEC-v7-KERNEL.md` (frozen 2026-11-12): a
framework layer of six components (fixing, judgment, appeal, settlement,
registry, deadlines) and one profile wired on top of it — two parties,
one submission, a PASS/FAIL verdict, one appeal, fair exchange. The
safety argument is made against the profile, not the framework.

## Live on testnet

Contract: **`sealgate7-ghost.testnet`**, first registered clerk
`sealgate7-clerk.testnet` (primary model
Qwen/Qwen3-VL-30B-A3B-Instruct, appeal panel z-ai/glm-5.3-flash, both
via NEAR AI Cloud with TEE-signed responses).

Seven cases were run end-to-end with real AI judgments on 2026-11-12
(full evidence: `ops/stage5-evidence.md`):

| case | shape | outcome |
|---|---|---|
| 0 | inspection, complete submission, 0.1 NEAR | PASS, released, opened by the buyer |
| 1 | inspection, price table missing | FAIL, refunded, never opened |
| 2 | inspection, borderline | FAIL, appealed, panel agreed — FAIL stands |
| 3 | platform appeal (adjudication), price 0 | PASS — the recorded suspension did not survive review |
| 4 | score-in-reason criteria, price 0 | PASS, signed reason begins "Score: 8/10." |
| 5 | exception-clause criteria | PASS, released |
| 6 | 7,935-byte submission | PASS, released |

Fees settle in the posting transaction from the signed usage, under a
cap fixed at case creation (base fee + per-token rates, starter-pays).
Case 0, for example: deposit cap 0.025785825 NEAR, settled charge
0.0254352 NEAR recomputed from the signed usage, 0.000350625 NEAR
refunded. An appeal that overturns is exercised end-to-end in the
offline demo and the exhaustive checker; in the live run the panel
agreed with the primary on the merits, so no live overturn occurred.

## Verify it yourself

```
npm install --ignore-scripts   # near-sdk-js' postinstall is not needed
npm test                       # 137 tests
npm run check:exhaustive       # 17,070 states, 38,347 transitions, all invariants hold
npm run check:attacks          # the 8 appendix-A attacks, all held
npm run clerk:demo             # offline end-to-end demo incl. an overturned appeal
npm run cli:demo               # the same flow through the party CLI
```

The exhaustive checker explores every reachable state of the kernel
itself (the contract and the reference machine run the same code in
`contract/src/kernel/`) and checks the conservation of money, the fee
rule, the single k2 rule, and the time-split release in all of them.

## Layout

- `contract/src/kernel/` — the six framework components and the v7
  profile; `contract/src/contract.ts` is the NEAR wrapper,
  `contract/machine.mjs` the in-memory host running the same code.
- `clerk/` — the reference clerk (judge) service: formal inspection,
  primary judgment, the appeal bench, the k2 client rules.
- `cli/` — the parties' command-line client (create, submit, appeal,
  finalize, open, verify).
- `shared/` — the sealing cryptography, record formats, response
  parsing, TEE signature checks.
- `check/` — the exhaustive state checker and the attack scripts.
- `ops/` — testnet setup, case material, and the stage-5 evidence file.

## Known limits

- Ciphertexts are stored base64-encoded, so on-chain storage runs about
  a third above the raw bytes the storage fee is computed on; the
  difference is carried by the contract account at testnet scale.
- The primary response container is a fixed 1,008 bytes; a reason close
  to the 400-character cap in a multibyte script may not fit, in which
  case the clerk stays silent and the case refunds in full. The
  reference skeleton asks the model to keep reasons within 300
  characters.
- On testnet the registry's owner powers sit with the contract account;
  a production deployment would place them under a multisig from
  genesis.

## Built with AI

This project was designed and built by an AI agent (the team's builder)
under a human team lead, using Claude Code (Opus) for specification and
implementation passes; every pass was executed and verified by running
the test suites, the exhaustive checker, and the live testnet cases
above. Libraries: near-sdk-js, near-api-js, @noble/ciphers,
@noble/curves, @noble/hashes, ethers (signature recovery only).

## License

All rights reserved (UNLICENSED in package.json).
