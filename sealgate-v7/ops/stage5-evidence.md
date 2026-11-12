# Stage 5 evidence — Sealgate v7 on NEAR testnet (2026-11-12)

Contract: `sealgate7-ghost.testnet` (init owner = the contract account itself)
Clerk (first registered judge): `sealgate7-clerk.testnet`
Parties: requester `sgbuyer-ghost.testnet`, submitter `sgworker-ghost.testnet`
Templates: inspection@1, adjudication@1 (registered by the clerk)
TEE signers registered from live NEAR AI Cloud calls: primary model
Qwen/Qwen3-VL-30B-A3B-Instruct, panel model z-ai/glm-5.3-flash.
Every decision below was posted by the clerk service from a real,
signature-verified NEAR AI Cloud response (usage rounded up to 1024-token
units inside the signed response; settlement executed in the posting
transaction under the H2 cap rule).

## Primary decisions (all posted 2026-11-12)

| case | shape | verdict | posted (UTC) | notes |
|---|---|---|---|---|
| 0 | inspection, price 0.1 NEAR, complete submission | PASS | 08:32:24 | usage {in 2048, out 1024} |
| 1 | inspection, price 0.1 NEAR, price table missing | FAIL | 08:36:35 | usage {in 2048, out 1024} |
| 2 | inspection, price 0.1 NEAR, one price not numeric | FAIL | 08:37:11 | appealed, see below |
| 3 | adjudication, price 0, platform suspension on record | PASS | 08:37:48 | the recorded zeroth decision did not survive review |
| 4 | inspection, price 0, score-in-reason criteria | PASS | 08:38:24 | criteria asked for "Score: N/10" in the reason, PASS at 6+ |
| 5 | inspection, price 0.1 NEAR, exception-clause criteria | PASS | 08:45:51 | "not disclosed" row accepted under the stated exception |
| 6 | inspection, price 0.1 NEAR, 7,935-byte submission | PASS | 08:48:47 | usage {in 3072, out 1024}; all buried maintenance notes found |

## Appeal (case 2)

- Appeal filed by the submitter (bond 0.1070552 NEAR + CAP_A deposit
  0.10574448 NEAR), requester responded with the matching bond.
- Integrity check passed (clerk log 08:39:34 UTC).
- Panel of three signed GLM calls agreed with the primary FAIL
  (panel_agrees), so no comparison call was made; appeal decision FAIL
  posted 08:40:43 UTC with usage {panel: 3 x {in 2048, out 1024},
  comparison: []}.
- Case closed as FAIL: price refunded to the requester, the appellant's
  bond paid to the requester, the requester's bond returned, CAP_A
  settled against panel usage only.

A live overturn was attempted by design (cases 2, 5, 6 were built as
borderline), but in each case the deciding bench judged the record the
same way on the merits, so no live overturn occurred. The overturn path
itself is exercised end-to-end by the clerk sandbox demo (FAIL -> panel
disagrees -> comparison overturns -> PASS -> k2 release -> byte-identical
decryption) and by the exhaustive checker, which reaches appeal-decision
endings in every regime.

## Closings (all seven cases Closed on chain)

| case | ending | notes |
|---|---|---|
| 0 | PASS_RELEASED | k2 carried by the paying finalize; requester opened the submission (byte-identical); fee settled from signed usage: CAP_1 deposit 0.025785825 NEAR, charge 0.0254352 NEAR, refund 0.000350625 NEAR |
| 1 | FAIL | price refunded to the requester; nothing released (k2 null) |
| 2 | FAIL | appeal upheld (panel_agrees); bonds and CAP_A settled as recorded above |
| 3 | PASS | price 0; the primary reason engages the zeroth decision's grounds directly: two listings within the hour are within the limit of three, and no listing IDs or timestamps were recorded |
| 4 | PASS | price 0; the signed reason begins "Score: 8/10." exactly as the criteria's format required |
| 5 | PASS_RELEASED | requester opened the submission; the "not disclosed" row is present |
| 6 | PASS_RELEASED | requester opened the 7,935-byte submission; all five maintenance notes present |

Party-side verification (`cli verify`) passed every check for cases
0, 1, 2, 5 and 6 (and case 4's record was read directly: verdict PASS,
reason with the score). Final regression at the end of stage 5:
unit/integration tests 137/137, attack scripts 8/8 held, exhaustive
checker 17,070 states / 38,347 transitions with all invariants true
(run at stage 4 against the same kernel build).
