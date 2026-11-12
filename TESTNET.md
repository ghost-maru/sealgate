# Live testnet run

Contract: `sealgate7-ghost.testnet`. Judge (clerk): `sealgate7-clerk.testnet`
— primary model Qwen/Qwen3-VL-30B-A3B-Instruct, appeal panel
z-ai/glm-5.3-flash, both via NEAR AI Cloud with TEE-signed responses.
Parties: `sgbuyer-ghost.testnet` / `sgworker-ghost.testnet`. Templates:
`inspection@1`, `adjudication@1`. Run on 2026-11-12; all nine cases are
Closed on chain. Case material is in `ops/cases/`.

| case | shape | outcome |
|---|---|---|
| 0 | inspection, complete submission, 0.1 NEAR | PASS, released, opened by the buyer |
| 1 | inspection, price table missing | FAIL, refunded, never opened |
| 2 | inspection, borderline | FAIL, appealed — panel agreed, FAIL stands |
| 3 | adjudication of a platform suspension, price 0 | PASS — the suspension was not upheld |
| 4 | score-in-reason criteria, price 0 | PASS, signed reason begins "Score: 8/10." |
| 5 | exception-clause criteria | PASS, released |
| 6 | 7,935-byte submission | PASS, released |
| 7 | inspection, never submitted | closed unsubmitted after the submit window; price refunded |
| 8 | inspection, complete submission, 0.1 NEAR | PASS, released, opened by the buyer |

Cases 0–6 ran on the first deployed build. The contract was then
redeployed with storage charged on the bytes actually stored (blobs are
stored as base64 strings, so storage is charged on the stored string
length, not the decoded length), and the clerk's base fees were updated
accordingly (primary 0.03 NEAR, appeal 0.13 NEAR; the caps at maximum
size are CAP_1 0.0322076 NEAR and CAP_A 0.1387776 NEAR). Cases 7 and 8
ran on the redeployed build under the new rates; existing cases kept
the terms pinned at their creation.

Fees settle in the posting transaction from the signed usage, under a
cap fixed at case creation. Case 0: deposit cap 0.025785825 NEAR,
settled charge 0.0254352 NEAR, 0.000350625 NEAR refunded. Case 8, under
the new rates: create deposit 0.1456 NEAR (0.1 price + 0.03 fixed record fee
+ 0.0156 storage for 1,560 stored bytes); submit deposit 0.048625825
NEAR (the case cap 0.030785825 for this case's lengths + 0.01784 storage for
1,784 stored bytes).

Case 2 is the only live appeal. The panel of three agreed with the
primary FAIL, so no comparison call was made: the price was refunded,
the appellant's bond was paid to the buyer, and the appeal deposit
settled against panel usage only. No live overturn has occurred; the
overturn path is exercised end-to-end by the offline demo
(`npm run clerk:demo`) and by the exhaustive checker. Case 3 was not
an appeal: as a primary adjudication the judge ruled PASS, because
the recorded grounds did not hold — two listings were within the
stated limit of three, and no listing IDs or timestamps had been
recorded.

Party-side verification (`cli verify`) passed for cases 0, 1, 2, 5, 6
and 8 (case 7 has no verdict to verify).
