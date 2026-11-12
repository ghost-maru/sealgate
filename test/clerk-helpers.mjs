// Shared helpers for the clerk tests (not a test file itself).
import { createSandbox, CONTRACT } from '../clerk/sandbox.mjs';
import { createClerk } from '../clerk/service.mjs';
import { mockAi, verifyMockSignature, verdictContent, comparisonContent, isComparison } from '../clerk/mock-ai.mjs';
import { PRIMARY_MODEL } from '../clerk/config.mjs';
import { ctxOf, dec, fromB64, LABELS } from '../shared/seal.mjs';
import { decodeRecord } from '../shared/record.mjs';

export const CRITERIA = '# Acceptance criteria\nA market report on five competitors, including a price table.';
export const SUBMISSION = '# Deliverables\nReport on five competitors. Section 4: price table.';
export const PRIMARY_REASON = 'PRIMARY-REASON-7f3a: the price table is missing.';

// A behavior by stage: primary verdict, panel verdicts (in call order,
// cycling), comparison decision. Each may also be a function returning a
// mock-ai behavior result.
export function staged({ primary = 'PASS', panel = ['PASS', 'PASS', 'PASS'], comparison = 'OVERTURN' } = {}) {
  let p = 0;
  return ({ model, request }) => {
    if (isComparison(request)) return typeof comparison === 'function' ? comparison() : { content: comparisonContent(comparison, 'comparison reason') };
    if (model === PRIMARY_MODEL) return typeof primary === 'function' ? primary() : { content: verdictContent(primary, PRIMARY_REASON) };
    const i = p++;
    return typeof panel === 'function' ? panel(i) : { content: verdictContent(panel[i % panel.length], `panel reason ${i}`) };
  };
}

export async function setupClerk({ behavior = staged(), options = {}, register = true } = {}) {
  const sb = createSandbox();
  if (register) await sb.register();
  const ai = mockAi(behavior);
  const logs = [];
  const clerk = createClerk({ chain: sb.clerk, ai, clerkSk: sb.keys.clerk.sk, verifySignature: verifyMockSignature, options, log: (s) => logs.push(s) });
  return { sb, ai, clerk, logs };
}

export function newClerk(sb, ai, options = {}) {
  return createClerk({ chain: sb.clerk, ai, clerkSk: sb.keys.clerk.sk, verifySignature: verifyMockSignature, options });
}

// Decrypts and decodes the primary response (default key: K1).
export function readResponse(sb, id, key = sb.cases[id].sub.K1) {
  const blob = sb.m.view('get_material', { case_id: id, slot: 'response' });
  return decodeRecord(dec(key, LABELS.resp0, fromB64(blob), ctxOf(CONTRACT, id)));
}
export function readAppealRecord(sb, id, key = sb.cases[id].sub.K1) {
  const blob = sb.m.view('get_material', { case_id: id, slot: 'record' });
  return decodeRecord(dec(key, LABELS.resp1, fromB64(blob), ctxOf(CONTRACT, id)));
}

export const randomB64 = (n) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256))).toString('base64');
export const comparisonCalls = (ai) => ai.calls.filter((c) => isComparison(c.request));
export const eventOf = (events, action) => events.find((e) => e.action === action);
