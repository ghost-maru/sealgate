// Strict parsing of model responses (SPEC §8.2, rules 1–7, and the
// comparison-stage schema). The input is always the exact signed response
// bytes (the chat-completion JSON), never a re-serialized object.
//
//   1. the response bytes are UTF-8 JSON;
//   2. take choices[0]; it must exist and its finish_reason must be exactly "stop";
//   3. message.content (a string) must be, as a whole, one JSON value
//      (surrounding JSON whitespace allowed, any other text is a failure);
//   4. that value is an object with exactly the two schema keys (any order);
//   5. verdict is exactly "PASS" or "FAIL" (decision: "UPHOLD" or "OVERTURN");
//   6. reason is a string of 1..400 UTF-16 code units;
//   7. otherwise the call does not count as a response.

export const REASON_MIN = 1;
export const REASON_MAX = 400; // UTF-16 code units (JavaScript string length)

const fatalUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function decodeJson(respBytes) {
  try { return { ok: true, value: JSON.parse(fatalUtf8.decode(respBytes)) }; } catch { return { ok: false }; }
}

// Rules 1–3 and the object part of rule 4.
export function parseEnvelope(respBytes) {
  const d = decodeJson(respBytes);
  if (!d.ok) return { ok: false, why: 'the response bytes are not UTF-8 JSON' };
  const resp = d.value;
  if (!isPlainObject(resp) || !Array.isArray(resp.choices)) return { ok: false, why: 'the response has no choices array' };
  const choice = resp.choices[0];
  if (!isPlainObject(choice)) return { ok: false, why: 'the response has no first choice' };
  if (choice.finish_reason !== 'stop') return { ok: false, why: `finish_reason is ${JSON.stringify(choice.finish_reason)}, not "stop"` };
  const content = isPlainObject(choice.message) ? choice.message.content : undefined;
  if (typeof content !== 'string') return { ok: false, why: 'message.content is not a string' };
  let obj;
  try { obj = JSON.parse(content); } catch { return { ok: false, why: 'message.content is not exactly one JSON value' }; }
  if (!isPlainObject(obj)) return { ok: false, why: 'message.content is not a JSON object' };
  return { ok: true, obj, resp };
}

function hasExactKeys(obj, keys) {
  const got = Object.keys(obj).sort();
  const want = [...keys].sort();
  return got.length === want.length && got.every((k, i) => k === want[i]);
}

export function reasonValid(r) {
  return typeof r === 'string' && r.length >= REASON_MIN && r.length <= REASON_MAX;
}

function parseSchema(respBytes, field, allowed) {
  const e = parseEnvelope(respBytes);
  if (!e.ok) return e;
  if (!hasExactKeys(e.obj, ['reason', field])) return { ok: false, why: `the object keys are [${Object.keys(e.obj).join(', ')}], not exactly reason and ${field}` };
  const v = e.obj[field];
  if (typeof v !== 'string' || !allowed.includes(v)) return { ok: false, why: `${field} is not exactly one of ${allowed.join(' / ')}` };
  if (!reasonValid(e.obj.reason)) return { ok: false, why: `reason is not a string of ${REASON_MIN}..${REASON_MAX} UTF-16 code units` };
  return { ok: true, [field]: v, reason: e.obj.reason };
}

// {"reason", "verdict"}: verdict PASS | FAIL.
export function parseVerdictResponse(respBytes) {
  return parseSchema(respBytes, 'verdict', ['PASS', 'FAIL']);
}

// {"decision", "reason"}: decision UPHOLD | OVERTURN (same strictness).
export function parseComparisonResponse(respBytes) {
  return parseSchema(respBytes, 'decision', ['UPHOLD', 'OVERTURN']);
}

// The exact token usage carried inside the signed response bytes
// (OpenAI-compatible `usage.prompt_tokens` / `usage.completion_tokens`).
// Returns { in, out } or null when the signed bytes carry no usable usage.
export function signedUsage(respBytes) {
  const d = decodeJson(respBytes);
  if (!d.ok || !isPlainObject(d.value) || !isPlainObject(d.value.usage)) return null;
  const { prompt_tokens: pin, completion_tokens: pout } = d.value.usage;
  if (!Number.isSafeInteger(pin) || pin < 0 || !Number.isSafeInteger(pout) || pout < 0) return null;
  return { in: pin, out: pout };
}
