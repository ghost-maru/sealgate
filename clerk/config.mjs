// Clerk configuration: every registration value of the reference clerk and
// every runtime knob, in one place (SPEC §6.1, §10.2, §10.3,
// decisions 2 and 6).
//
// ---------------------------------------------------------------------------
// Registration values (register_clerk args; pinned into each case at creation)
// ---------------------------------------------------------------------------
//
// Models (§10.2, appendix A): primary Qwen/Qwen3-VL-30B-A3B-Instruct at
// temperature 0, one call; blind panel and comparison z-ai/glm-5.3-flash
// (a different family). Temperature is not a registry field: the skeleton
// fixes it at 0 for every stage (shared/skeleton.mjs TEMPERATURE).
//
// Token prices (provider price + FX buffer only, no margin):
//   provider prices, NEAR AI Cloud, verified 2026-11-12, USD per 1M tokens:
//     Qwen3-VL-30B   input 0.15   output 0.55   (context 16K)
//     GLM 5.3 Flash  input 0.08   output 0.50
//   assumed NEAR/USD reference rate: 2.50 USD per NEAR (ASSUMPTION, to be
//   refreshed by the operator before registration)
//   FX buffer: 25 %, applied by converting at 2.50 / 1.25 = 2.00 USD per NEAR,
//   i.e. the clerk breaks even on tokens down to a 20 % fall of NEAR/USD.
//   yocto per token = (micro-USD per 1M tokens) * 10^14 / (USD cents per NEAR)
//     Qwen in  : 150000 * 1e14 / 200 = 7.5e16  yocto/token
//     Qwen out : 550000 * 1e14 / 200 = 2.75e17 yocto/token
//     GLM in   :  80000 * 1e14 / 200 = 4.0e16  yocto/token
//     GLM out  : 500000 * 1e14 / 200 = 2.5e17  yocto/token
//
// max_tokens M_s:
//   primary 1024: a verdict JSON with a <= 400-char reason is ~150 tokens; the
//     whole signed response must also fit the 1006-byte resp0 container.
//   panel / comparison 4096: GLM 5.3 Flash spends output tokens on reasoning
//     before the JSON (v5 saw finish_reason=length at 400 tokens and raised
//     the budget to 1500); 4096 leaves headroom so finish_reason is "stop".
//
// Overhead bounds P_s (skeleton + chat format, tokens; tokens <= bytes for a
// byte-level BPE): the judgment skeleton text plus framing is ~2.0 KB of JSON
// bytes, the comparison skeleton ~2.6 KB (test/clerk-skeleton.test.mjs checks
// both against these bounds with a 256-token chat-format margin).
//   P_1 = P_p = 3072, P_c = 4096.
//
// Base fees (margin lives here):
//   base_1 = 0.03 NEAR: resp0 storage (stored base64 length 1400 B)
//            * 1e19 = 0.014 NEAR + post_decision gas (<= 0.005 NEAR)
//            + the k2 finalize the clerk sends on a PASS (<= 0.005 NEAR)
//            + margin (~0.006 NEAR).
//   base_A = 0.13 NEAR: resp1 storage (stored base64 length 10976 B)
//            * 1e19 = 0.10976 NEAR + post_appeal_decision gas
//            (<= 0.005 NEAR) + margin (~0.0152 NEAR).
//
// Size limits (§10.2, derived from the primary model's 16K-token context):
//   L_crit = L_sub = 8192 bytes, L_tpl = 4096 bytes. Worst primary input in
//   bytes: 8192 + 8192 + 4096 + ~2 KB skeleton = ~22.5 KB. At typical density
//   (English prose ~0.25 tokens/byte, Japanese ~0.3-0.5) that is <= ~11.3K
//   tokens, plus M_1 = 1024 output tokens: within 16,384. Dense content
//   (random strings, base64) can exceed the context; §11.6 assigns that case
//   to clerk silence.
//
// W1 (§10.2): 12 hours; the demo variant (SEALGATE_DEMO=1) registers 30 minutes.
//
// Resulting caps (computed by the contract from on-chain lengths, §6.1), at
// the maximum sizes (criteria and submission ciphertexts 9256 B each,
// template 4096 B): CAP_1 = 0.0322076 NEAR, CAP_A (= bond floor)
// = 0.1387776 NEAR. test/clerk-register.test.mjs recomputes them.

export const NEAR = 10n ** 24n;

export const PRIMARY_MODEL = 'Qwen/Qwen3-VL-30B-A3B-Instruct';
export const PANEL_MODEL = 'z-ai/glm-5.3-flash';

export const PRICE_BASIS = Object.freeze({
  referenceNearUsdCents: 250n, // assumed 1 NEAR = 2.50 USD
  fxBufferPercent: 25n,        // convert at reference / 1.25
});
export const EFFECTIVE_NEAR_USD_CENTS = (PRICE_BASIS.referenceNearUsdCents * 100n) / (100n + PRICE_BASIS.fxBufferPercent); // 200n

// Provider prices in micro-USD per 1M tokens (NEAR AI Cloud, verified 2026-11-12).
export const PROVIDER_PRICES = Object.freeze({
  [PRIMARY_MODEL]: { in: 150000n, out: 550000n },
  [PANEL_MODEL]: { in: 80000n, out: 500000n },
});

// Integer yocto per token, rounded up.
export function yoctoPerToken(microUsdPerMTok, nearUsdCents = EFFECTIVE_NEAR_USD_CENTS) {
  const num = microUsdPerMTok * 10n ** 14n;
  return (num + nearUsdCents - 1n) / nearUsdCents;
}
const stage = (model, maxTokens, overheadTokens) => ({
  p_in: yoctoPerToken(PROVIDER_PRICES[model].in).toString(),
  p_out: yoctoPerToken(PROVIDER_PRICES[model].out).toString(),
  max_tokens: maxTokens,
  overhead_tokens: overheadTokens,
});

export const W1_SEC = 12 * 3600;
export const W1_SEC_DEMO = 30 * 60;

// register_clerk arguments without the per-deployment fields (account,
// seal_key, fee_account), which come from the runtime environment.
export const REGISTRATION = Object.freeze({
  w1_sec: W1_SEC,
  base_1: (30n * NEAR / 1000n).toString(),  // 0.03 NEAR
  base_a: (130n * NEAR / 1000n).toString(), // 0.13 NEAR
  stages: {
    primary: stage(PRIMARY_MODEL, 1024, 3072),
    panel: stage(PANEL_MODEL, 4096, 3072),
    comparison: stage(PANEL_MODEL, 4096, 4096),
  },
  primary_model: PRIMARY_MODEL,
  panel_model: PANEL_MODEL,
  l_crit: 8192,
  l_sub: 8192,
  l_tpl: 4096,
});

// ---------------------------------------------------------------------------
// Client rule and service knobs
// ---------------------------------------------------------------------------

// §7.6 / §10.3: release safety margin, provisional value.
export const RELEASE_MARGIN_MS = 10 * 60 * 1000;

export const SERVICE_DEFAULTS = Object.freeze({
  pollMs: 15_000,
  startCaseId: 0,
  primaryAttempts: 3,     // model calls tried for one primary judgment (invalid responses are retried, never billed)
  panelAttempts: 9,       // calls tried to collect 3 valid blind-panel outputs
  comparisonAttempts: 3,  // calls tried to obtain one valid comparison output
  deadlineGuardMs: 2 * 60 * 1000, // stop retrying this close to the clerk's deadline
  releaseMarginMs: RELEASE_MARGIN_MS,
  forceK2: false,         // the explicit override of §7.6; never on by default
});

export const NEARAI_API = 'https://cloud-api.near.ai';
export const DEFAULT_RPC = 'https://rpc.testnet.near.org';
export const CALL_GAS = '300000000000000'; // 300 Tgas; unused gas is refunded

// Runtime environment (read only by the entry point, never by the logic
// modules, so tests never touch the network or secrets).
//   SEALGATE_LIVE=1                 allow network access (off by default)
//   SEALGATE7_CONTRACT              v7 contract account id
//   NEAR_RPC_URL                    default https://rpc.testnet.near.org
//   SEALGATE_CLERK_ACCOUNT          the clerk's NEAR account
//   SEALGATE_CLERK_KEY_FILE         NEAR key JSON of the clerk account (secret_key / private_key)
//   SEALGATE_CLERK_SEAL_KEY_FILE    the clerk's X25519 sealing secret key (64 hex chars)
//   SEALGATE_FEE_ACCOUNT            fee account (default: the clerk account)
//   SEALGATE_OWNER_ACCOUNT          contract owner (registration only)
//   SEALGATE_OWNER_KEY_FILE         NEAR key JSON of the owner (registration only)
//   NEARAI_API_KEY                  NEAR AI Cloud API key (same variable as v5)
//   SEALGATE_DEMO=1                 register the demo W1 (30 minutes)
//   SEALGATE_CLERK_POLL_MS, SEALGATE_CLERK_START_CASE
export function runtimeConfig(env = process.env) {
  return {
    live: env.SEALGATE_LIVE === '1',
    contract: env.SEALGATE7_CONTRACT || null,
    rpcUrl: env.NEAR_RPC_URL || DEFAULT_RPC,
    clerkAccount: env.SEALGATE_CLERK_ACCOUNT || null,
    clerkKeyFile: env.SEALGATE_CLERK_KEY_FILE || null,
    clerkSealKeyFile: env.SEALGATE_CLERK_SEAL_KEY_FILE || null,
    feeAccount: env.SEALGATE_FEE_ACCOUNT || env.SEALGATE_CLERK_ACCOUNT || null,
    ownerAccount: env.SEALGATE_OWNER_ACCOUNT || null,
    ownerKeyFile: env.SEALGATE_OWNER_KEY_FILE || null,
    nearAiApiKey: env.NEARAI_API_KEY || null,
    demo: env.SEALGATE_DEMO === '1',
    pollMs: env.SEALGATE_CLERK_POLL_MS ? Number(env.SEALGATE_CLERK_POLL_MS) : SERVICE_DEFAULTS.pollMs,
    startCaseId: env.SEALGATE_CLERK_START_CASE ? Number(env.SEALGATE_CLERK_START_CASE) : SERVICE_DEFAULTS.startCaseId,
  };
}

export function registrationFor({ demo = false } = {}) {
  return demo ? { ...REGISTRATION, w1_sec: W1_SEC_DEMO } : { ...REGISTRATION };
}
