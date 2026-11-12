// shared/seal.mjs (SPEC §7): context string, salted commitments,
// Enc / Seal round trips, the padding scheme and its exact lengths, the K1/K2
// split and lock, the clerk's format checks, and an end-to-end exchange run
// through the reference machine with real material.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as seal from '../shared/seal.mjs';
import { fixing } from '../contract/machine.mjs';
import {
  CLERK, R, S, T0, HOUR, HALF_W, setup, createStorage, submitStorage, RESP0_STORAGE, finalize, rejects,
} from './fixture.mjs';

const CONTRACT = 'sealgate7.testnet';
const ctx = seal.ctxOf(CONTRACT, 7);
const k32 = () => seal.randomBytes(32);

test('context string is "sealgate7|" || contract || "|" || case id', () => {
  assert.equal(seal.fromUtf8(ctx), 'sealgate7|sealgate7.testnet|7');
});

test('commitment = sha256(salt || body) with a 16-byte salt', () => {
  const salt = seal.newSalt();
  assert.equal(salt.length, 16);
  const body = 'criteria text';
  const want = createHash('sha256').update(Buffer.concat([salt, Buffer.from(body)])).digest('hex');
  assert.equal(seal.commit(salt, body), want);
  assert.notEqual(seal.commit(seal.newSalt(), body), want);
  assert.throws(() => seal.commit(new Uint8Array(15), body));
});

test('padding: u16be length prefix + random fill; 1 KB buckets for std/sub, fixed 1008 / 8192 for responses', () => {
  assert.equal(seal.paddedLen(0), 1024);
  assert.equal(seal.paddedLen(1022), 1024);   // 1022 + 2 = 1024
  assert.equal(seal.paddedLen(1023), 2048);
  assert.equal(seal.paddedLen(16 + 8192), 9216); // max submission: salt + prefix push past 8 KB
  const m = seal.utf8('hello');
  const p = seal.pad(m, 1024);
  assert.equal(p.length, 1024);
  assert.deepEqual([p[0], p[1]], [0, 5]);
  assert.deepEqual(seal.unpad(p), m);
  assert.equal(seal.padSizeFor('resp0', 3), 1008);
  assert.equal(seal.padSizeFor('resp1', 3), 8192);
  assert.throws(() => seal.pad(new Uint8Array(1007), 1008)); // |m| > N - 2
  assert.equal(seal.pad(new Uint8Array(1006), 1008).length, 1008);
  // Two paddings of the same message differ only in the random fill.
  const q = seal.pad(m, 1024);
  assert.deepEqual(q.slice(0, 7), p.slice(0, 7));
  assert.notDeepEqual(q.slice(7), p.slice(7));
});

test('Enc / Dec round trip; ciphertext = nonce(24) || AEAD(pad(m)) with a 16-byte tag', () => {
  const k = k32();
  for (const [label, len, want] of [['std', 16 + 2000, 2088], ['sub', 16 + 4000, 4136], ['sub', 16 + 8192, 9256], ['resp0', 900, 1048], ['resp1', 5000, 8232]]) {
    const m = seal.randomBytes(len);
    const ct = seal.enc(k, label, m, ctx);
    assert.equal(ct.length, want, `${label} ${len}`);
    assert.deepEqual(seal.dec(k, label, ct, ctx), m);
  }
  const ct = seal.enc(k, 'std', seal.utf8('x'), ctx);
  assert.throws(() => seal.dec(k, 'sub', ct, ctx));                        // wrong label
  assert.throws(() => seal.dec(k, 'std', ct, seal.ctxOf(CONTRACT, 8)));    // wrong case: context mismatch
  assert.throws(() => seal.dec(k, 'std', ct, seal.ctxOf('other.testnet', 7)));
  assert.throws(() => seal.dec(k32(), 'std', ct, ctx));                    // wrong key
  const bad = ct.slice(); bad[30] ^= 1;
  assert.throws(() => seal.dec(k, 'std', bad, ctx));                       // tampered
  assert.throws(() => seal.enc(k, 'resp0', new Uint8Array(1007), ctx));    // responses must fit the fixed size
});

test('ciphertext lengths agree with the contract\'s length rules (seal.mjs vs kernel fixing.js)', () => {
  for (const L of [1, 1000, 1006, 1007, 1008, 4096, 8192, 8193, 20000]) {
    assert.equal(seal.maxBucketCiphertextLen(L), fixing.maxBucketCiphertextLen(L), `L = ${L}`);
  }
  for (let n = 0; n < 5000; n += 97) assert.equal(seal.paddedLen(n), fixing.paddedLen(n));
  assert.equal(seal.RESP0_CT_LEN, 1048);
  assert.equal(seal.RESP1_CT_LEN, 8232);
});

test('Seal / open round trip; envelope sizes 80 (wSkS, wR) and 144 (wC); deterministic for a given e', () => {
  const r = seal.keypair();
  const e = k32();
  const m = k32();
  const env = seal.seal(r.pk, m, 'wR', e, ctx);
  assert.equal(env.length, 80);
  assert.deepEqual(seal.open(r.sk, env, 'wR', ctx), m);
  assert.deepEqual(seal.seal(r.pk, m, 'wR', e, ctx), env); // same (e, m, label, ctx) -> same bytes
  assert.throws(() => seal.open(r.sk, env, 'wC', ctx));
  assert.throws(() => seal.open(r.sk, env, 'wR', seal.ctxOf(CONTRACT, 8)));
  assert.throws(() => seal.open(seal.keypair().sk, env, 'wR', ctx));
  assert.equal(seal.seal(r.pk, new Uint8Array(96), 'wC', k32(), ctx).length, 144);
  // An all-zero shared secret (low-order point) is rejected.
  assert.throws(() => seal.seal(new Uint8Array(32), m, 'wR', e, ctx));
});

test('K1/K2 split: K1 = K xor K2, lock = sha256(K2), K1 alone is independent of K', () => {
  const { K, K2, K1, lock } = seal.splitKey();
  assert.deepEqual(seal.joinKey(K1, K2), K);
  assert.equal(lock, createHash('sha256').update(K2).digest('hex'));
  assert.ok(seal.checkLock(K2, lock));
  assert.ok(!seal.checkLock(K1, lock));
  // Same K, different K2 -> different K1 (K1 reveals nothing about K by itself).
  const again = seal.splitKey(K);
  assert.notDeepEqual(again.K1, K1);
  assert.deepEqual(seal.joinKey(again.K1, again.K2), K);
});

test('usage is declared rounded up to 1,024-token units', () => {
  assert.equal(seal.roundUsage(3100), 4096);
  assert.equal(seal.roundUsage(412), 1024);
  assert.equal(seal.roundUsage(1024), 1024);
  assert.equal(seal.roundUsage(0), 0);
});

function material() {
  const r = seal.keypair(), s = seal.keypair(), c = seal.keypair();
  const crit = seal.buildCriteria({ contract: CONTRACT, caseId: 0, criteria: 'Must include a price table for 5 competitors.', submitterPk: s.pk });
  const SK = seal.open(s.sk, seal.fromB64(crit.env_s), 'wSkS', seal.ctxOf(CONTRACT, 0));
  const sub = seal.buildSubmission({ contract: CONTRACT, caseId: 0, submission: 'Report ... section 4: price table ...', SK, clerkPk: c.pk, requesterPk: r.pk });
  return { r, s, c, crit, SK, sub };
}

test('format checks 1-4 pass on honest material and catch each kind of defect', () => {
  const { r, c, crit, sub } = material();
  const mat = { ...crit, ...sub };
  const check = (over, caseId = 0) => seal.formatCheck({ contract: CONTRACT, caseId, clerkSk: c.sk, requesterPk: r.pk, material: { ...mat, ...over }, lCrit: 8192, lSub: 8192 });
  const ok = check({});
  assert.equal(ok.ok, true);
  assert.equal(seal.fromUtf8(ok.submission), 'Report ... section 4: price table ...');
  assert.equal(check({}, 1).defect, 1);                                  // copied into another case
  assert.equal(check({ criteria_hash: '00'.repeat(32) }).defect, 2);
  assert.equal(check({ sub_hash: '00'.repeat(32) }).defect, 3);
  assert.equal(check({ lock: '00'.repeat(32) }).defect, 4);
  const badEnvR = seal.toB64(seal.seal(r.pk, k32(), 'wR', k32(), seal.ctxOf(CONTRACT, 0)));
  assert.equal(check({ env_r: badEnvR }).defect, 4);                       // R's envelope would not open K
  assert.equal(seal.formatCheck({ contract: CONTRACT, caseId: 0, clerkSk: c.sk, requesterPk: r.pk, material: mat, lCrit: 8192, lSub: 10 }).defect, 3);
});

test('end to end through the machine: R reads the reason via K1 before payment, the submission only after the paying finalize', () => {
  const { m } = setup();
  const r = seal.keypair(), s = seal.keypair(), clerk = seal.keypair();
  m.call('register_key', { caller: R, now: T0 }, { pubkey: seal.toHex(r.pk) });
  m.call('register_key', { caller: S, now: T0 }, { pubkey: seal.toHex(s.pk) });
  const caseId = m.view('next_case_id');
  const cctx = seal.ctxOf(m.contractId, caseId);
  const crit = seal.buildCriteria({ contract: m.contractId, caseId, criteria: 'x'.repeat(2000), submitterPk: s.pk });
  const amount = 10n ** 24n;
  const cargs = { clerk: CLERK, template_id: 'inspection', template_version: 1, submitter: S, amount: amount.toString(), criteria_hash: crit.criteria_hash, criteria_ct: crit.criteria_ct, env_s: crit.env_s, submit_window_sec: 86400, expected_case_id: caseId };
  m.call('create_case', { caller: R, now: T0, deposit: amount + createStorage() }, cargs);

  // S opens SK, checks the criteria hash, builds the submission.
  const SK = seal.open(s.sk, seal.fromB64(m.view('get_material', { case_id: caseId, slot: 'env_s' })), 'wSkS', cctx);
  const critBack = seal.splitSalted(seal.dec(SK, 'std', seal.fromB64(m.view('get_material', { case_id: caseId, slot: 'criteria_ct' })), cctx));
  assert.equal(seal.commit(critBack.salt, critBack.body), m.getCase(caseId).criteria.hash);
  const sub = seal.buildSubmission({ contract: m.contractId, caseId, submission: 'y'.repeat(4000), SK, clerkPk: clerk.pk, requesterPk: r.pk });
  const subLen = seal.fromB64(sub.sub_ct).length;
  assert.equal(subLen, 4136);
  const cap1 = BigInt(m.view('quote_fee', { case_id: caseId, kind: 'primary', sub_len: subLen }));
  m.call('submit', { caller: S, now: T0 + HOUR, deposit: cap1 + submitStorage(subLen) }, { case_id: caseId, sub_hash: sub.sub_hash, sub_ct: sub.sub_ct, env_c: sub.env_c, env_r: sub.env_r, lock: sub.lock });

  // The clerk runs the format checks from chain data only, then posts PASS with the response under K1.
  const onchain = (slot) => m.view('get_material', { case_id: caseId, slot });
  const c0 = m.getCase(caseId);
  const fc = seal.formatCheck({ contract: m.contractId, caseId, clerkSk: clerk.sk, requesterPk: seal.fromHex(c0.requesterKey), lCrit: 8192, lSub: 8192,
    material: { criteria_hash: c0.criteria.hash, criteria_ct: onchain('criteria_ct'), sub_hash: c0.submission.hash, sub_ct: onchain('sub_ct'), env_c: onchain('env_c'), env_r: onchain('env_r'), lock: c0.submission.lock } });
  assert.equal(fc.ok, true);
  const K1 = seal.xor(fc.K, fc.K2);
  const response = seal.encResponse(K1, JSON.stringify({ reason: 'Price table present in section 4.', verdict: 'PASS' }), cctx);
  m.call('post_decision', { caller: CLERK, now: T0 + 2 * HOUR, deposit: RESP0_STORAGE }, { case_id: caseId, verdict: 'PASS', response: seal.toB64(response), usage: [{ in: seal.roundUsage(3100), out: seal.roundUsage(412) }] });

  // R opens K1 from its envelope and reads the reason, but cannot open the submission.
  const rK1 = seal.open(r.sk, seal.fromB64(onchain('env_r')), 'wR', cctx);
  const reason = JSON.parse(seal.fromUtf8(seal.dec(rK1, 'resp0', seal.fromB64(onchain('response')), cctx)));
  assert.equal(reason.verdict, 'PASS');
  assert.throws(() => seal.dec(rK1, 'sub', seal.fromB64(onchain('sub_ct')), cctx));

  // The paying finalize carries k2; afterwards R computes K = K1 xor k2 and opens the submission.
  const at = T0 + 2 * HOUR + HALF_W + 1;
  rejects(assert, () => finalize(m, at, caseId), 'E_K2_REQUIRED');
  finalize(m, at, caseId, seal.toHex(fc.K2), CLERK);
  const k2 = seal.fromHex(m.getCase(caseId).k2);
  const K = seal.joinKey(rK1, k2);
  const opened = seal.splitSalted(seal.dec(K, 'sub', seal.fromB64(onchain('sub_ct')), cctx));
  assert.equal(seal.fromUtf8(opened.body), 'y'.repeat(4000));
  assert.equal(seal.commit(opened.salt, opened.body), m.getCase(caseId).submission.hash);
});
