# Two independent agents (R5)

The original demo escrows were all driven by one operator holding every key —
the Opus concept review called this out: no two independent agents had ever
traded through Sealgate. This demo fixes that.

`run.sh` executes a full trade (escrow **#9** on
`app2.sealgate-ghost.testnet`) between two CLI processes:

| | Buyer process | Worker process |
|---|---|---|
| NEAR keys | `buyer/.keys/buyer.json` only | `worker/.keys/worker.json` only |
| X25519 key | `buyer/.keys/x25519-buyer.json` | `worker/.keys/x25519-worker.json` |
| Record view | `buyer/records/` | `worker/records/` |
| Selected via | `SEALGATE_KEYS_DIR`, `SEALGATE_RECORDS_DIR`, `SEALGATE_PARTY` | same |

Neither process can sign for the other, and neither starts with the other's
record. The private material crosses only as **sealed bundles**
(`cli/bundle.mjs`: ephemeral X25519 → HKDF → XChaCha20-Poly1305):

1. **Engagement bundle** (buyer → worker): the criteria and the commitment
   salt, sealed to the worker's on-chain registered X25519 key. The worker
   needs both to do the work and to compute its salted deliverable
   commitment. (Secrecy is against the public chain, not between the
   parties — the worker must know its own spec.)
2. **Deliverable bundle** (worker → buyer): the deliverable, sealed to the
   buyer's key. The buyer accepts it **only if** `sha256(salt ‖ deliverable)`
   equals the on-chain `deliverableHash` — the chain, not the sender, is the
   source of truth.
3. The worker runs the TEE inspection and posts the L0 claim; the buyer
   verifies it against its own record — recovering the response bytes by
   decrypting the on-chain ciphertext with its own key, since it never held
   the inspector's local record — and co-signs. Fast finality settles the
   escrow: **Final, PASS**.

Appeals under the L1 redesign follow the same pattern with a third actor:
the appellant seals the record to the **appellate executor**
(`appeal-prepare`), and only the executor can open it, run the appellate
protocol, and post the L1 claim (`appeal <id> <bundle>`).
