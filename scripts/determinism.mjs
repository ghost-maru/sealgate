// R4 measurement: is temperature-0 hosted inference deterministic in practice?
// Runs the identical canonical request N times per model and records verdicts/reasons.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { verifiedCall } from '../cli/ai.mjs';
import { buildInspectionRequest, buildBlindRequest, MODELS } from '../shared/templates.mjs';
import { parseVerdict } from '../shared/verify.mjs';

const KEY = process.env.NEARAI_API_KEY;
const rec = JSON.parse(readFileSync(new URL('../records/6.json', import.meta.url), 'utf8'));
const args = { escrowRef: 'app2.sealgate-ghost.testnet#6', criteria: rec.criteria, deliverable: rec.deliverable, salt: rec.salt };
const N = 6;
const out = ['# Determinism measurement (2026-11-09)', '', `Identical canonical request bytes, temperature 0, N=${N} per model. Escrow #6 record (salted).`, ''];

for (const [label, model, req] of [
  ['L0 inspection (Qwen3-VL)', MODELS.L0, buildInspectionRequest(args)],
  ['L1 blind (GLM-5.3-flash)', MODELS.L1, buildBlindRequest(args)],
]) {
  const verdicts = [], reasons = new Set();
  for (let i = 0; i < N; i++) {
    const c = await verifiedCall(KEY, model, req);
    const p = parseVerdict(c.respBytes);
    verdicts.push(p.verdict);
    reasons.add(p.reason);
    console.log(label, i + 1, p.verdict);
  }
  out.push(`## ${label}`, `- verdicts: ${verdicts.join(', ')}`, `- distinct reasons: ${reasons.size} of ${N}`, ...[...reasons].map((r) => `  - "${r}"`), '');
}
mkdirSync(new URL('../dryruns/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dryruns/determinism.md', import.meta.url), out.join('\n'));
console.log('written dryruns/determinism.md');
