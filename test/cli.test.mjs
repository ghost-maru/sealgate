// Stage-3 CLI tests: the commands of cli/commands.mjs driven in-process
// against the offline sandbox (real kernel, real §7 crypto, mock AI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSandbox, R, S, CLERK } from '../clerk/sandbox.mjs';
import { MachineChain } from '../clerk/chain.mjs';
import { createClerk } from '../clerk/service.mjs';
import { mockAi, verifyMockSignature } from '../clerk/mock-ai.mjs';
import { templateDeposit } from '../clerk/register.mjs';
import { RELEASE_MARGIN_MS } from '../clerk/config.mjs';
import { staged } from './clerk-helpers.mjs';
import * as cmd from '../cli/commands.mjs';
import { CliError, EXIT } from '../cli/util.mjs';
import { utf8 } from '../shared/seal.mjs';

const NEAR = 10n ** 24n;
const CRITERIA = '# Acceptance criteria\nA market report on five competitors, including a price table.';
const SUBMISSION = '# Deliverables\nReport on five competitors. Section 4: price table.';

async function world(behavior = staged()) {
  const sb = createSandbox();
  await sb.register();
  const casesDir = mkdtempSync(join(tmpdir(), 'sealgate7-cli-test-'));
  const clerk = createClerk({ chain: sb.clerk, ai: mockAi(behavior), clerkSk: sb.keys.clerk.sk, verifySignature: verifyMockSignature });
  const ctxFor = (account, key) => ({
    chain: new MachineChain(sb.m, { accountId: account, clock: sb.clock }),
    account, sealKey: key, casesDir, out: () => {},
    verifySignature: verifyMockSignature, marginMs: RELEASE_MARGIN_MS,
    makeClerk: async () => clerk,
  });
  return {
    sb, clerk,
    asR: ctxFor(R, sb.keys.R), asS: ctxFor(S, sb.keys.S), asC: ctxFor(CLERK, sb.keys.clerk),
  };
}

const createInspection = (w, over = {}) => cmd.cmdCreate(w.asR, {
  clerk: CLERK, template: { id: 'inspection', version: 1 }, submitter: S,
  criteria: utf8(CRITERIA), amount: 5n * NEAR, submitWindowSec: 86400, wSec: 3600, ...over,
});

test('create: an amount_zero template (adjudication) rejects a price above 0', async () => {
  const w = await world();
  await assert.rejects(
    cmd.cmdCreate(w.asR, { clerk: CLERK, template: { id: 'adjudication', version: 1 }, submitter: S, criteria: utf8('# Case file\nTerms.'), amount: 1n, submitWindowSec: 86400, allowMissingInputs: true }),
    (e) => e instanceof CliError && /amount|price|zero/i.test(e.message),
  );
  const ok = await cmd.cmdCreate(w.asR, { clerk: CLERK, template: { id: 'adjudication', version: 1 }, submitter: S, criteria: utf8('# Case file\nTerms.'), amount: 0n, submitWindowSec: 86400, allowMissingInputs: true });
  assert.equal(w.sb.getCase(ok.caseId).amount, '0');
});

test('preflight flags a missing declared submission input; submit refuses, then succeeds with the override', async () => {
  const w = await world();
  // A test-only template with a submission-side required input.
  const t = { template_id: 'checklist', body: 'checklist@1 - the submission must contain a deliverables heading.', declarations: { constraints: [], required_inputs: [{ side: 'submission', heading: '## Deliverables' }] } };
  w.sb.m.call('register_template', { caller: CLERK, now: w.sb.state.now, deposit: templateDeposit(t) }, { template_id: t.template_id, body: t.body, constraints: [], required_inputs: t.declarations.required_inputs });

  const { caseId } = await cmd.cmdCreate(w.asR, { clerk: CLERK, template: { id: 'checklist', version: 1 }, submitter: S, criteria: utf8(CRITERIA), amount: 1n * NEAR, submitWindowSec: 86400 });
  const bare = utf8('A report with no deliverables heading.');
  const pf = await cmd.cmdPreflight(w.asS, { caseId, submission: bare });
  assert.equal(pf.ok, false);
  assert.ok(pf.problems.some((p) => p.includes('## Deliverables')), pf.problems.join(' | '));
  await assert.rejects(cmd.cmdSubmit(w.asS, { caseId, submission: bare }), (e) => e instanceof CliError);
  const sub = await cmd.cmdSubmit(w.asS, { caseId, submission: bare, allowMissingInputs: true });
  assert.ok(sub.deposit > 0n);
  assert.equal(w.sb.getCase(caseId).phase, 'AwaitingDecision');
  // The quoted CAP_1 is what the case recorded.
  assert.equal(w.sb.getCase(caseId).fee1.deposit, sub.cap1.toString());
});

test('full flow: PASS, k2 refused inside the margin, forced release, open round-trips, verify passes', async () => {
  const w = await world(staged({ primary: 'PASS' }));
  const { caseId } = await createInspection(w);
  await cmd.cmdSubmit(w.asS, { caseId, submission: utf8(SUBMISSION) });
  await w.clerk.step(caseId);
  assert.equal(w.sb.getCase(caseId).phase, 'Decided');

  // Final at decision + W/2 (30 min). Jump to 5 min before the release deadline:
  // inside the 10-minute safety margin, so the client rule refuses without --force.
  const c = w.sb.getCase(caseId);
  const releaseDeadline = c.decision.at + 3600_000; // final (at + W/2) + W/2
  w.sb.at(releaseDeadline - 5 * 60_000);
  await assert.rejects(cmd.cmdFinalize(w.asS, { caseId }), (e) => e instanceof CliError && e.exitCode === EXIT.K2_REFUSED);
  const fin = await cmd.cmdFinalize(w.asS, { caseId, force: true });
  assert.equal(fin.k2Sent, true);
  assert.equal(w.sb.getCase(caseId).ending, 'PASS_RELEASED');

  const opened = await cmd.cmdOpen(w.asR, { caseId, print: false });
  assert.equal(Buffer.from(opened.submission).toString(), SUBMISSION);

  const vR = await cmd.cmdVerify(w.asR, { caseId });
  assert.equal(vR.ok, true, vR.checks.filter((x) => x.status === 'fail').map((x) => `${x.name}: ${x.detail}`).join(' | '));
  const vS = await cmd.cmdVerify(w.asS, { caseId });
  assert.equal(vS.ok, true, vS.checks.filter((x) => x.status === 'fail').map((x) => `${x.name}: ${x.detail}`).join(' | '));

  // A local template copy that differs from the pinned body fails verify.
  const vBad = await cmd.cmdVerify(w.asR, { caseId, templateBody: utf8('some other template') });
  assert.equal(vBad.ok, false);
  assert.ok(vBad.checks.some((x) => x.name === 'template.local' && x.status === 'fail'));
});

test('finalize after the release window sends no k2: PASS_UNRELEASED', async () => {
  const w = await world(staged({ primary: 'PASS' }));
  const { caseId } = await createInspection(w);
  await cmd.cmdSubmit(w.asS, { caseId, submission: utf8(SUBMISSION) });
  await w.clerk.step(caseId);
  const c = w.sb.getCase(caseId);
  w.sb.at(c.decision.at + 3600_000 + 1000); // past final + W/2
  const fin = await cmd.cmdFinalize(w.asS, { caseId, force: true }); // force cannot revive k2
  assert.equal(fin.k2Sent, false);
  assert.equal(w.sb.getCase(caseId).ending, 'PASS_UNRELEASED');
  await assert.rejects(cmd.cmdOpen(w.asR, { caseId }), (e) => e instanceof CliError);
});

test('price-0 adjudication: formal PASS (no zeroth-decision record), finalize carries no k2', async () => {
  const w = await world();
  const { caseId } = await cmd.cmdCreate(w.asR, { clerk: CLERK, template: { id: 'adjudication', version: 1 }, submitter: S, criteria: utf8('# Case file\nTerms, but no record.'), amount: 0n, submitWindowSec: 86400, allowMissingInputs: true });
  await cmd.cmdSubmit(w.asS, { caseId, submission: utf8('My evidence.') });
  await w.clerk.step(caseId);
  const c = w.sb.getCase(caseId);
  assert.equal(c.decision.verdict, 'PASS');
  assert.deepEqual(c.decision.usage, []);
  w.sb.at(c.decision.at + 86400_000 + 1000); // past finality under the default W (24h)
  const fin = await cmd.cmdFinalize(w.asR, { caseId });
  assert.equal(fin.k2Sent, false);
  assert.equal(w.sb.getCase(caseId).phase, 'Closed');
});
