# Sealgate MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
Sealgate CLI (`cli/sealgate.mjs`) as MCP tools, so an AI agent can run an escrow
end-to-end: create → register keys → deliver → inspect → (dispute → respond → appeal)
→ co-sign / finalize, plus read-only show / verify / receipt tools.

It is a thin wrapper with no protocol logic of its own. Each tool spawns
`node cli/sealgate.mjs <command> ...` with the repo root as cwd, passes the
server's environment through, and returns the CLI's combined stdout+stderr as
text. A non-zero CLI exit becomes an MCP tool error (`isError: true`) carrying
that output. The one exception is `sealgate_verify_receipt`: exit code 1 means
"NOT VERIFIED", which is returned as a normal result; only exit codes > 1 are errors.

Built on the official SDK (`@modelcontextprotocol/sdk`, `McpServer` +
`StdioServerTransport`). Tool input schemas use `zod`, which ships with the SDK.

## Run

```sh
npm install
node mcp/server.mjs     # speaks MCP over stdio
node mcp/smoke.mjs      # smoke test: lists tools, show + verify escrow #2 (public testnet RPC, no API key)
```

## Client configuration

Add to your MCP client config (Claude Desktop `claude_desktop_config.json`, Claude
Code `.mcp.json`, etc.). Use an absolute path to `server.mjs`.

```json
{
  "mcpServers": {
    "sealgate": {
      "command": "node",
      "args": ["/absolute/path/to/sealgate/mcp/server.mjs"],
      "env": {
        "NEARAI_API_KEY": "<your NEAR AI API key; only needed for inspect/appeal>",
        "SEALGATE_CONTRACT": "<contract account; defaults to app2.sealgate-ghost.testnet>"
      }
    }
  }
}
```

## Tools

All arguments are JSON. `escrowId` is an integer; `party` is `"buyer"` or `"worker"`.

| Tool | Arguments | CLI | Effect | Moves funds? |
|---|---|---|---|---|
| `sealgate_show` | `escrowId` | `show <id>` | On-chain escrow state + internal balances | No (read-only) |
| `sealgate_verify` | `escrowId` | `verify <id>` | Integrity check of latest claim vs local record + signer registry | No (read-only) |
| `sealgate_receipt` | `escrowId` | `receipt <id>` | Writes `receipts/<id>.receipt.json` | No (writes a local file) |
| `sealgate_verify_receipt` | `path` | `verify-receipt <path>` | Receipt check: offline cryptographic stage + live signer-registry check | No (read-only) |
| `sealgate_create` | `criteria`, `amountNear`, optional v4 terms (`caseType`, `bondBps`, `bondFloorNear`, `wHours`, `w1Min`, `maxFeeBps`) | `create <tmpfile> <near> [caseType] [flags]` | Buyer creates an escrow under snapshot terms; prints the new id | **Yes** |
| `sealgate_create_open` | `criteria`, `amountNear`, `claimHours`, `deliverHours`, `settleHours`, optional `caseType` + terms | `create-open …` | Posts an OPEN JOB (no worker yet); prints the publication salt | **Yes** |
| `sealgate_open_jobs` | — | `open-jobs` | Lists unclaimed jobs with full terms (read before claiming) | No (read-only) |
| `sealgate_claim_job` | `escrowId`, `criteria`, optional `salt`, optional acceptance-policy bounds | `claim-job <id> <tmpfile> [salt]` | Worker claims a job after verifying the commitment and terms | **Yes** |
| `sealgate_register_keys` | `escrowId`, optional acceptance-policy bounds | `register-keys <id>` | Registers both parties' X25519 pubkeys (worker registration names the terms hash) | Signs txs (gas only) |
| `sealgate_deliver` | `escrowId`, `deliverable` | `deliver <id> <tmpfile>` | Worker commits deliverable hash + on-chain ciphertext | Signs a tx (gas only) |
| `sealgate_inspect` | `escrowId` | `inspect <id>` | L0 AI inspection + posts encrypted claim (needs `NEARAI_API_KEY`) | **Yes** (claim bond) |
| `sealgate_decrypt` | `escrowId`, `party` | `decrypt <id> <party>` | Decrypts latest claim's AI response with a local key | No (read-only) |
| `sealgate_dispute` | `escrowId`, `grounds` (object) | `dispute <id> <tmpfile>` | Counterparty disputes; posts 2×B0 + the 0.01 NEAR appeal fee | **Yes** |
| `sealgate_respond` | `escrowId` | `respond <id>` | Claimant posts 1×B0 response funding | **Yes** |
| `sealgate_appeal` | `escrowId` | `appeal-prepare <id>` then `appeal <id> bundles/<id>.json` | Seals the bundle, then the executor runs integrity → blind panel → comparison and posts the L1 claim (no bond; needs `NEARAI_API_KEY`) | Signs txs (gas only) |
| `sealgate_cosign` | `escrowId`, `party` | `co-sign <id> <party>` | Party co-signs the outcome | **Yes** |
| `sealgate_finalize` | `escrowId` | `finalize <id>` | Buyer finalizes / settles | **Yes** |

Text arguments (`criteria`, `deliverable`, `grounds`) are written to a private temp
directory (mode 0600), passed to the CLI as a file path, and deleted afterwards.

## Security note

The write tools sign NEAR **testnet** transactions as the Sealgate demo accounts,
using local key files under `.keys/` in the working tree. Those files are
gitignored and are **not** in this repository; a fresh clone has no keys, so
write tools will fail until you provide your own. Anyone running this server with
their own keys is operating their own accounts, and any agent connected to it can
move those accounts' testnet funds and post claims without further confirmation.
Treat the server as having the full authority of whatever keys sit in `.keys/`,
and only connect agents you trust to act with that authority.

The server never reads `.keys/` itself (the CLI does), and does not log
environment variable values; `NEARAI_API_KEY` is only passed through to the CLI
process.
