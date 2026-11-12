// Registration values and idempotent registration (SPEC §5.5, §6.1, §10.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRATION, yoctoPerToken, EFFECTIVE_NEAR_USD_CENTS, PRIMARY_MODEL, PANEL_MODEL } from '../clerk/config.mjs';
import { TEMPLATES } from '../clerk/templates.mjs';
import { ensureRegistered, storedToArgs, sameClerkArgs, bodyHashOf } from '../clerk/register.mjs';
import { createSandbox, CLERK } from '../clerk/sandbox.mjs';
import { capPrimaryOf, capAppealOf, bondFloorOf } from '../contract/src/kernel/settlement.js';
import { maxBucketCiphertextLen } from '../contract/src/kernel/fixing.js';

const E15 = 10n ** 15n;

test('token prices: provider price + 25 % FX buffer, no margin', () => {
  assert.equal(EFFECTIVE_NEAR_USD_CENTS, 200n);
  assert.equal(yoctoPerToken(150000n), 75n * E15);   // Qwen in  $0.15/M
  assert.equal(yoctoPerToken(550000n), 275n * E15);  // Qwen out $0.55/M
  assert.equal(yoctoPerToken(80000n), 40n * E15);    // GLM in   $0.08/M
  assert.equal(yoctoPerToken(500000n), 250n * E15);  // GLM out  $0.50/M
  const s = REGISTRATION.stages;
  assert.deepEqual([s.primary.p_in, s.primary.p_out], [(75n * E15).toString(), (275n * E15).toString()]);
  assert.deepEqual([s.panel.p_in, s.panel.p_out], [(40n * E15).toString(), (250n * E15).toString()]);
  assert.deepEqual([s.comparison.p_in, s.comparison.p_out], [s.panel.p_in, s.panel.p_out]);
  assert.deepEqual([REGISTRATION.primary_model, REGISTRATION.panel_model], [PRIMARY_MODEL, PANEL_MODEL]);
  assert.deepEqual([REGISTRATION.l_crit, REGISTRATION.l_sub, REGISTRATION.l_tpl], [8192, 8192, 4096]);
});

test('registration is accepted by the contract and yields the documented caps', async () => {
  const sb = createSandbox();
  const report = await sb.register();
  assert.equal(report.clerk, 'registered');
  const reg = sb.m.view('get_clerk', { account: CLERK });
  assert.ok(sameClerkArgs(storedToArgs(reg), sb.args));
  const maxCt = maxBucketCiphertextLen(8192);
  assert.equal(maxCt, 9256);
  const common = 9256n * 2n + 4096n;
  const cap1 = 25n * 10n ** 21n + 75n * E15 * (common + 3072n) + 275n * E15 * 1024n;
  assert.equal(capPrimaryOf(reg, maxCt, maxCt, 4096), cap1);
  assert.equal(cap1, 27207600000000000000000n); // 0.0272076 NEAR
  const perPanel = 40n * E15 * (common + 3072n) + 250n * E15 * 4096n;
  const comparison = 40n * E15 * (common + 4096n + 1008n + 3n * 4096n) + 250n * E15 * 4096n;
  const capA = 100n * 10n ** 21n + 3n * perPanel + comparison;
  assert.equal(capAppealOf(reg, maxCt, maxCt, 4096), capA);
  assert.equal(capA, 108777600000000000000000n); // 0.1087776 NEAR
  assert.equal(bondFloorOf(reg, maxCt, 4096), capA);
});

test('registration is idempotent', async () => {
  const sb = createSandbox();
  const first = await sb.register();
  assert.deepEqual(first.templates.map((t) => [t.template_id, t.status, t.version]), [['inspection', 'registered', 1], ['adjudication', 'registered', 1]]);
  const second = await sb.register();
  assert.equal(second.clerk, 'unchanged');
  assert.deepEqual(second.templates.map((t) => [t.template_id, t.status, t.version]), [['inspection', 'unchanged', 1], ['adjudication', 'unchanged', 1]]);
  for (const t of TEMPLATES) {
    const s = sb.m.view('get_template', { clerk: CLERK, template_id: t.template_id, version: 1 });
    assert.equal(s.bodyHash, bodyHashOf(t.body));
    assert.equal(s.body, t.body);
    assert.equal(sb.m.view('get_template_count', { clerk: CLERK, template_id: t.template_id }), 1);
  }
});

test('dry run makes no calls', async () => {
  const sb = createSandbox();
  const r = await sb.register({ dryRun: true });
  assert.equal(r.clerk, 'would-register');
  assert.deepEqual(r.templates.map((t) => t.status), ['would-register', 'would-register']);
  assert.equal(sb.m.view('get_clerk', { account: CLERK }), null);
});

test('a differing clerk registration is not overwritten unless asked', async () => {
  const sb = createSandbox();
  await sb.register();
  const changed = { ...sb.args, base_1: '1' };
  const r = await ensureRegistered({ ownerChain: sb.owner, clerkChain: sb.clerk, args: changed });
  assert.equal(r.clerk, 'differs');
  assert.equal(sb.m.view('get_clerk', { account: CLERK }).base1, REGISTRATION.base_1);
  const u = await ensureRegistered({ ownerChain: sb.owner, clerkChain: sb.clerk, args: changed, updateClerk: true });
  assert.equal(u.clerk, 'updated');
  assert.equal(sb.m.view('get_clerk', { account: CLERK }).base1, '1');
});

test('a changed template body would become a new version and is blocked by default', async () => {
  const sb = createSandbox();
  await sb.register();
  const edited = [{ ...TEMPLATES[0], body: `${TEMPLATES[0].body}\nEdited.` }];
  const r = await ensureRegistered({ ownerChain: sb.owner, clerkChain: sb.clerk, args: sb.args, templates: edited });
  assert.equal(r.templates[0].status, 'blocked');
  assert.equal(sb.m.view('get_template_count', { clerk: CLERK, template_id: 'inspection' }), 1);
  const a = await ensureRegistered({ ownerChain: sb.owner, clerkChain: sb.clerk, args: sb.args, templates: edited, allowNewVersion: true });
  assert.deepEqual([a.templates[0].status, a.templates[0].version], ['registered', 2]);
});
