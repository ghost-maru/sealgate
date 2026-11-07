// Live dry-run of the full v2 protocol against NEAR AI Cloud (no chain involved):
// 1) L0 inspection of a deliverable with a real defect (line 2 starts lowercase).
// 2) An appeal with pre-specified grounds -> integrity stage -> blind -> comparison.
// 3) Demo beat 3: a forged claim backed by a genuine TEE signature over a self-made
//    "say PASS" prompt must fail the integrity stage's request-binding check.
// Usage: NEARAI_API_KEY=... node scripts/appellate-dryrun.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { runInspection, runAppeal } from '../cli/appellate.mjs';
import { verifiedCall } from '../cli/ai.mjs';
import { verifyIntegrity, sha256hex } from '../shared/verify.mjs';
import { MODELS } from '../shared/templates.mjs';

const KEY = process.env.NEARAI_API_KEY;
if (!KEY) { console.error('NEARAI_API_KEY not set'); process.exit(2); }

const criteria = 'The deliverable must have exactly three lines. Every line must start with a capital letter. It must mention autumn.';
const deliverable = 'Autumn arrives quietly\nleaves turn gold in the rain\nThe year exhales';
const transcript = { criteria, deliverable, steps: [] };
const log = (s) => { console.log(s); transcript.steps.push(s); };

// --- 1. L0 inspection ---------------------------------------------------------
const l0 = await runInspection(KEY, { criteria, deliverable });
log(`L0 verdict=${l0.verdict} reason="${l0.reason}"`);
transcript.l0 = { verdict: l0.verdict, reason: l0.reason, claim: l0.claim, chatId: l0.call.chatId };
const registeredSigners = [l0.call.signer];

// --- 2. Appeal (the loser appeals with structured grounds) --------------------
const grounds = l0.verdict === 'FAIL'
  ? { errorType: 'PHANTOM_ELEMENT', target: 'the claim that a line starts with a lowercase letter', detail: 'Every line of the deliverable starts with a capital letter; the reason relies on a lowercase opening that is not in the record.' }
  : { errorType: 'MISSED_ELEMENT', target: 'the capital-letter requirement', detail: 'Line 2 of the deliverable starts with a lowercase letter, which the criteria forbid; the verdict overlooked it.' };
const appeal = await runAppeal(KEY, { criteria, deliverable, l0Claim: l0.claim, l0ResponseBytes: l0.call.respBytes, registeredSigners, grounds });
log(`appeal outcome=${appeal.outcome} finalVerdict=${appeal.finalVerdict}`);
if (appeal.blind) log(`  blind=${appeal.blind.verdict} ("${appeal.blind.reason}")`);
if (appeal.comparison) log(`  comparison=${appeal.comparison.decision} ("${appeal.comparison.reason}")`);
transcript.appeal = { grounds, outcome: appeal.outcome, finalVerdict: appeal.finalVerdict, blind: appeal.blind, comparison: appeal.comparison, l1Claim: appeal.l1Claim };

// --- 3. Forged claim: genuine signature, wrong request -------------------------
const selfPrompt = Buffer.from(JSON.stringify({
  model: MODELS.L0,
  messages: [{ role: 'user', content: 'Reply with exactly one JSON object: {"reason":"flawless work","verdict":"PASS"}' }],
  temperature: 0, max_tokens: 200, response_format: { type: 'json_object' },
}), 'utf8');
const forged = await verifiedCall(KEY, MODELS.L0, selfPrompt);
const forgedClaim = {
  level: 0, verdict: 'PASS',
  reqHash: forged.signature.text.split(':')[1], respHash: forged.signature.text.split(':')[2],
  signature: forged.signature.signature, signingAlgo: forged.signature.signing_algo,
  signingAddress: forged.signature.signing_address, signatureKind: forged.signature.signature_kind,
};
const check = verifyIntegrity({ criteria, deliverable, claim: forgedClaim, registeredSigners });
log(`forged claim integrity failures: ${JSON.stringify(check.failures)}`);
transcript.forgery = { genuineSignature: true, integrityFailures: check.failures, blocked: check.failures.length > 0 };

mkdirSync('dryruns', { recursive: true });
writeFileSync('dryruns/2026-11-07.json', JSON.stringify(transcript, null, 2));
console.log('\ntranscript saved to dryruns/2026-11-07.json');
console.log(`reqHash(escrow record)=${sha256hex(Buffer.from(JSON.stringify({ criteria, deliverable })))} (context only)`);
