// The k2 client rule (SPEC §5.3, §5.4, §7.6).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideK2Send, releaseCheck } from '../clerk/k2.mjs';
import { RELEASE_MARGIN_MS } from '../clerk/config.mjs';
import { NEAR } from '../clerk/sandbox.mjs';
import { setupClerk, newClerk, staged, CRITERIA, SUBMISSION, eventOf } from './clerk-helpers.mjs';

const MIN = 60_000;
const DEADLINE = 1_700_000_000_000;
const M = 10 * MIN;

test('the release margin is the provisional 10 minutes', () => {
  assert.equal(RELEASE_MARGIN_MS, 10 * MIN);
});

test('decideK2Send: before final + W/2 with the margin met -> send', () => {
  const d = decideK2Send({ now: DEADLINE - 60 * MIN, deadline: DEADLINE, marginMs: M });
  assert.deepEqual([d.action, d.send], ['send', true]);
  assert.equal(decideK2Send({ now: DEADLINE - M, deadline: DEADLINE, marginMs: M }).action, 'send'); // exactly the margin
});

test('decideK2Send: margin too small -> refuse by default', () => {
  for (const now of [DEADLINE - M + 1, DEADLINE - MIN, DEADLINE]) {
    const d = decideK2Send({ now, deadline: DEADLINE, marginMs: M });
    assert.deepEqual([d.action, d.send], ['refuse', false], `now = deadline - ${DEADLINE - now}`);
  }
});

test('decideK2Send: the force flag overrides the margin', () => {
  for (const now of [DEADLINE - M + 1, DEADLINE]) {
    const d = decideK2Send({ now, deadline: DEADLINE, marginMs: M, force: true });
    assert.deepEqual([d.action, d.send, d.forced], ['send', true, true]);
  }
  // force on a comfortable margin is an ordinary send
  assert.equal(decideK2Send({ now: DEADLINE - 60 * MIN, deadline: DEADLINE, marginMs: M, force: true }).forced, undefined);
});

test('decideK2Send: after the window there is no k2, force or not', () => {
  for (const force of [false, true]) {
    const d = decideK2Send({ now: DEADLINE + 1, deadline: DEADLINE, marginMs: M, force });
    assert.deepEqual([d.action, d.send], ['expired', false]);
  }
});

test('decideK2Send: is a pure function of its inputs', () => {
  const a = decideK2Send({ now: DEADLINE - 5 * MIN, deadline: DEADLINE, marginMs: M });
  const b = decideK2Send({ now: DEADLINE - 5 * MIN, deadline: DEADLINE, marginMs: M });
  assert.deepEqual(a, b);
  assert.equal(decideK2Send({ now: DEADLINE, deadline: DEADLINE, marginMs: 0 }).action, 'send');
  assert.throws(() => decideK2Send({ now: 'x', deadline: DEADLINE, marginMs: M }), TypeError);
  assert.throws(() => decideK2Send({ now: 1, deadline: DEADLINE, marginMs: -1 }), RangeError);
});

test('releaseCheck: only a final PASS with amount > 0 is eligible', async () => {
  const { sb, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  const c = sb.getCase(id);
  const halfW = c.wMs / 2;
  assert.equal(releaseCheck(c, c.decision.at).wait, true); // not final: appeal still possible
  assert.equal(releaseCheck(c, c.decision.at + halfW).wait, true); // the deadline itself is still open
  const st = releaseCheck(c, c.decision.at + halfW + 1);
  assert.equal(st.eligible, true);
  assert.equal(st.finalAt, c.decision.at + halfW);
  assert.equal(st.deadline, c.decision.at + 2 * halfW);
  assert.equal(releaseCheck({ ...c, amount: '0' }, c.decision.at + halfW + 1).eligible, false);
  assert.equal(releaseCheck({ ...c, decision: { ...c.decision, verdict: 'FAIL' } }, c.decision.at + halfW + 1).eligible, false);
  assert.equal(releaseCheck({ ...c, phase: 'Closed' }, c.decision.at + halfW + 1).eligible, false);
});

test('service: k2 waits for finality, then releases; the requester gets paid content', async () => {
  const { sb, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  await clerk.tick(); // same time: not final, nothing sent
  assert.equal(sb.getCase(id).phase, 'Decided');
  assert.equal(sb.getCase(id).k2, null);
  sb.advance(sb.getCase(id).wMs / 2 + 1);
  const ev = await clerk.tick();
  assert.ok(eventOf(ev, 'k2_released'));
  const c = sb.getCase(id);
  assert.equal(c.ending, 'PASS_RELEASED');
  assert.equal(c.k2, Buffer.from(sb.cases[id].sub.K2).toString('hex'));
  assert.equal(sb.m.balance('bob.testnet'), BigInt(c.fee1.refund) + 5n * NEAR);
});

test('service: margin too small -> refused by default, sent with the force flag', async () => {
  const { sb, ai, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  const c0 = sb.getCase(id);
  const halfW = c0.wMs / 2;
  sb.at(c0.decision.at + 2 * halfW - 5 * MIN); // 5 minutes before final + W/2
  const ev = await clerk.tick();
  assert.ok(eventOf(ev, 'k2_refuse'));
  assert.equal(sb.getCase(id).phase, 'Decided');
  assert.equal(sb.getCase(id).k2, null);
  const forced = newClerk(sb, ai, { forceK2: true });
  const ev2 = await forced.tick();
  assert.equal(eventOf(ev2, 'k2_released').forced, true);
  assert.equal(sb.getCase(id).ending, 'PASS_RELEASED');
});

test('service: after the window no k2 is sent; finalize without k2 refunds', async () => {
  const { sb, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  const c0 = sb.getCase(id);
  sb.at(c0.decision.at + c0.wMs + 1); // past final + W/2
  const ev = await clerk.tick();
  assert.ok(eventOf(ev, 'k2_expired'));
  assert.equal(sb.getCase(id).k2, null);
  sb.m.call('finalize', { caller: 'carol.testnet', now: sb.clock() }, { case_id: id });
  assert.equal(sb.getCase(id).ending, 'PASS_UNRELEASED');
});

test('service: amount 0 never sends k2', async () => {
  const { sb, clerk } = await setupClerk({ behavior: staged({ primary: 'PASS' }) });
  const id = sb.createCase({ criteria: CRITERIA, amount: 0n });
  sb.submit(id, SUBMISSION);
  await clerk.tick();
  sb.advance(sb.getCase(id).wMs / 2 + 1);
  const ev = await clerk.tick();
  assert.equal(eventOf(ev, 'k2_released'), undefined);
  assert.equal(sb.getCase(id).k2, null);
});
