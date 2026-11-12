// Builds docs/index.html (GitHub Pages) from site/index.template.html by
// injecting the public demo record (escrow #2) as the SAMPLE constant.
//   node site/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const rec = JSON.parse(readFileSync(new URL('../records/2.json', import.meta.url), 'utf8'));
const sample = {
  escrowId: 2,
  criteria: rec.criteria,
  deliverable: rec.deliverable,
  response: Buffer.from(rec.l0.responseB64, 'base64').toString('utf8'),
};
const template = readFileSync(new URL('./index.template.html', import.meta.url), 'utf8');
if (!template.includes('/*__SAMPLE_RECORD__*/')) throw new Error('sample placeholder missing from template');
const html = template.replace('/*__SAMPLE_RECORD__*/', `const SAMPLE = ${JSON.stringify(sample)};`);
writeFileSync(new URL('../docs/index.html', import.meta.url), html);
console.log('docs/index.html built with demo record for escrow #2');
