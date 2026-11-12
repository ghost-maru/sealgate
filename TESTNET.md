# Live testnet run

Contract: `sealgate7-ghost.testnet`. Judge (clerk): `sealgate7-clerk.testnet`
— primary model Qwen/Qwen3-VL-30B-A3B-Instruct, appeal panel
z-ai/glm-5.3-flash, both via NEAR AI Cloud with TEE-signed responses.
Parties: `sgbuyer-ghost.testnet` / `sgworker-ghost.testnet`. Templates:
`inspection@1`, `adjudication@1`. Run on 2026-11-12; all seven cases are
Closed on chain. Case material is in `ops/cases/`.

| case | shape | outcome |
|---|---|---|
| 0 | inspection, complete submission, 0.1 NEAR | PASS, released, opened by the buyer |
| 1 | inspection, price table missing | FAIL, refunded, never opened |
| 2 | inspection, borderline | FAIL, appealed — panel agreed, FAIL stands |
| 3 | adjudication of a platform suspension, price 0 | PASS — the suspension did not survive review |
| 4 | score-in-reason criteria, price 0 | PASS, signed reason begins "Score: 8/10." |
| 5 | exception-clause criteria | PASS, released |
| 6 | 7,935-byte submission | PASS, released |

Fees settle in the posting transaction from the signed usage, under a
cap fixed at case creation. Case 0: deposit cap 0.025785825 NEAR,
settled charge 0.0254352 NEAR, 0.000350625 NEAR refunded.

Case 2's appeal: the panel of three agreed with the primary FAIL, so no
comparison call was made; the price was refunded, the appellant's bond
paid to the requester, and the appeal deposit settled against panel
usage only. No live overturn occurred — the panel agreed with the
primary on the merits in every appealed case. The overturn path is
exercised end-to-end by the offline demo (`npm run clerk:demo`) and by
the exhaustive checker.

Party-side verification (`cli verify`) passed for cases 0, 1, 2, 5
and 6.
