// Small CLI helpers: errors with exit codes, argument parsing, NEAR amounts,
// durations, formatting. No chain access, no secrets.

export const NEAR = 10n ** 24n;

// Exit codes (documented in cli/main.mjs usage).
export const EXIT = Object.freeze({
  OK: 0,
  CHECK_FAILED: 1, // a verification failed (verify, preflight problems, open mismatch, post-check)
  REFUSED: 2,      // usage error or a precondition the CLI refuses to act on; nothing was sent
  K2_REFUSED: 3,   // finalize: the k2 client rule refused to send (margin not met, no --force)
});

export class CliError extends Error {
  constructor(message, exitCode = EXIT.REFUSED) {
    super(message);
    this.exitCode = exitCode;
  }
}

// --flag value | --flag=value | boolean flags. Flags may appear anywhere.
export const BOOLEAN_FLAGS = new Set([
  'force', 'dry-run', 'json', 'print', 'allow-missing-inputs', 'show-template', 'help',
]);
export function parseArgv(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 2) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2);
    if (BOOLEAN_FLAGS.has(k)) { flags[k] = true; continue; }
    if (i + 1 >= argv.length) throw new CliError(`--${k} needs a value`);
    flags[k] = argv[++i];
  }
  return { pos, flags };
}

// "5", "0.5", "0" NEAR -> yocto (exact; at most 24 decimals).
export function parseNear(s) {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/.test(s)) throw new CliError(`not a NEAR amount: ${JSON.stringify(s)} (use e.g. 5, 0.5, 0)`);
  const [i, f = ''] = s.split('.');
  return BigInt(i) * NEAR + BigInt((f + '0'.repeat(24)).slice(0, 24));
}
export function parseYocto(s, name = 'amount') {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s)) throw new CliError(`${name} must be a decimal integer of yocto`);
  return BigInt(s);
}
export function formatNear(y) {
  const v = BigInt(y);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const frac = (a % NEAR).toString().padStart(24, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${a / NEAR}${frac ? `.${frac}` : ''} NEAR`;
}
export const yoctoAndNear = (y) => `${BigInt(y)} yocto (${formatNear(y)})`;

// "90s", "30m", "12h", "3d", or plain seconds -> whole seconds.
export function parseDuration(s, name = 'duration') {
  const m = /^([0-9]+)(s|m|h|d)?$/.exec(String(s));
  if (!m) throw new CliError(`${name} must look like 90s, 30m, 12h, 3d or a number of seconds`);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2] || 's'];
  const v = Number(m[1]) * mult;
  if (!Number.isSafeInteger(v)) throw new CliError(`${name} is too large`);
  return v;
}

export function parseCaseId(s) {
  if (s === undefined || !/^(0|[1-9][0-9]*)$/.test(String(s))) throw new CliError('a case id (non-negative integer) is required');
  return Number(s);
}

// "inspection@1" -> { id, version }
export function parseTemplateRef(s) {
  const m = /^([A-Za-z0-9._-]{1,64})@([1-9][0-9]*)$/.exec(String(s || ''));
  if (!m) throw new CliError('--template must be <id>@<version>, e.g. inspection@1');
  return { id: m[1], version: Number(m[2]) };
}

export const iso = (ms) => new Date(ms).toISOString();
export function span(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const mi = Math.floor(s / 60); s -= mi * 60;
  const parts = [d && `${d}d`, h && `${h}h`, mi && `${mi}m`, (s || (!d && !h && !mi)) && `${s}s`].filter(Boolean);
  return `${neg ? '-' : ''}${parts.join(' ')}`;
}
export const short = (hex) => (typeof hex === 'string' && hex.length > 16 ? `${hex.slice(0, 16)}...` : hex);

// JSON with bigint and byte arrays made printable.
export function toJson(v) {
  return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof Uint8Array ? Buffer.from(x).toString('base64') : x), 2);
}

export function equalBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
