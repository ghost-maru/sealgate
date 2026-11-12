# Sealgate

**A judge neither side controls.**

Sealgate is a neutral AI judge for parties who do not trust each other.
When work is bought online, the buyer can inspect the finished work,
declare it not good enough, and refuse to pay — and there is no neutral
party to settle the dispute. Sealgate settles it: the work and the
acceptance criteria are sealed before judging, an independent AI judge
rules pass or fail, payment follows the ruling, and either side can
appeal once.

Unlike escrow or spending-guard tools, which only move money on a
signal, Sealgate judges the work itself against the criteria — and a
rejected delivery is never revealed to the buyer. Because the ruling is
recorded on-chain, it cannot be rewritten or denied later, and anyone
can verify that a given delivery passed a given judge.

Built for the NEAR Hackathon "Build Beyond Boundaries" (Nov 2026).
Tracks: Agent Economy · AI Security & Defense · Privacy & Private AI.

- Contract (testnet): `sealgate7-ghost.testnet`
- Live testnet cases: [TESTNET.md](TESTNET.md)
- Specification: [SPEC.md](SPEC.md)

## How it works

1. **The record is sealed first.** Criteria and submission are committed
   as salted hashes and ciphertext. Plaintext never touches the chain,
   and no second version of the record can be shown to the judge.
2. **The judge is pinned in advance.** The judge (clerk), its model, and
   its fees are snapshotted into the case at creation. Nobody can swap
   them mid-case.
3. **The verdict is signed in a TEE.** Every verdict is signed inside
   NEAR AI Cloud's secure enclave and recorded on-chain against the
   registry: who judged what, on which record. If the judge stays
   silent past its deadline, that silence is on the record too, the
   case refunds in full, and anyone can force it to close.
4. **One appeal, blind.** Either side may appeal once, under equal
   bonds. A different model family re-judges the record without seeing
   the first verdict, and overturns only for a clear error.
5. **Fair exchange.** The judge never moves money; the contract settles
   by the ruling. The payment transaction itself carries the release
   key, so the buyer can decrypt the delivery only by paying for it —
   a FAIL can never be used to read the work for free.

Sealgate is a judgment kernel. For a single case it does exactly five
things: fix the record, return a signed judgment, allow one appeal,
settle, and leave the material for later verification. Collecting
submissions, screening, ranking, and distributing prizes are the
caller's work, built on top of the kernel.

## Verify

```
npm install --ignore-scripts
npm test                    # 137 tests
npm run check:exhaustive    # 17,070 states, 38,347 transitions, all invariants hold
npm run check:attacks       # 8 attack scripts, all held
npm run clerk:demo          # offline end-to-end demo, incl. an overturned appeal
npm run cli:demo            # the same flow through the party CLI
```

## Layout

- `contract/` — the NEAR contract. `contract/src/kernel/` holds the six
  framework components (fixing, judgment, appeal, settlement, registry,
  deadlines) and the profile wired on top of them; `contract/machine.mjs`
  runs the same code in memory for testing.
- `clerk/` — the reference judge service: formal inspection, primary
  judgment, the appeal bench.
- `cli/` — the parties' command-line client (create, submit, appeal,
  finalize, open, verify).
- `shared/` — sealing cryptography, record formats, TEE signature checks.
- `check/` — the exhaustive state checker and the attack scripts.
- `ops/` — the material of the live testnet cases and a reason reader.
- `test/` — the test suite.

## Known limits

- The primary response container is a fixed 1,008 bytes. A reason close
  to the 400-character cap in a multibyte script may not fit, in which
  case the judge stays silent and the case refunds in full. The
  reference templates ask the model to keep reasons within 300
  characters.
- On testnet the registry's owner powers sit with the contract account;
  a production deployment would place them under a multisig.

## License

All rights reserved. See [LICENSE](LICENSE).
