// Sealgate CLI: drives the full v2 protocol against the testnet contract.
// The parties' shared off-chain record lives in records/<escrowId>.json — criteria and
// deliverable plaintext exist ONLY there and in the two parties' hands, never on-chain.
// Usage: node cli/sealgate.mjs <command> ...   (NEARAI_API_KEY in env for AI steps)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseNearAmount } from 'near-api-js';
import { CONTRACT, ACCOUNTS, view, call, partyOf } from './chain.mjs';
import { termsOfChain, termsHash, bondOfChain, describeTerms } from '../shared/terms.mjs';
import { sha256hex, verifyIntegrity, verifyResponseBinding, parseVerdict, validateBundleSalt } from '../shared/verify.mjs';
import { buildBlindRequest, MODELS, validateGrounds } from '../shared/templates.mjs';
import { verifiedCall } from './ai.mjs';
import { runInspection, runAppeal, decidePanel } from './appellate.mjs';
import { genKeypair, deriveKey, encryptResponse, decryptResponse, getPublicKeyHex, encryptDeliverable, decryptDeliverable, MAX_DELIVERABLE_BYTES } from '../shared/encrypt.mjs';
import { buildReceipt, verifyReceipt } from '../shared/receipt.mjs';
import { sealBundle, openBundle } from './bundle.mjs';
import { CREATE_STORAGE, storageChargeFor } from '../contract/machine.mjs';

// v5 storage deposits (attached, exact): the create charge is flat; the
// deliverable/response charges are per-byte on the ciphertext being stored.
// Legacy-generation escrows (termsVersion !== 2) predate the charges.
const createStorageDeposit = CREATE_STORAGE;
const storageFor = (e, len) => (e.termsVersion === 2 ? storageChargeFor(len) : 0n);

const KEY = process.env.NEARAI_API_KEY;
const recDir = process.env.SEALGATE_RECORDS_DIR || 'records';
mkdirSync(recDir, { recursive: true });
const recPath = (id) => `${recDir}/${id}.json`;
const loadRec = (id) => JSON.parse(readFileSync(recPath(id), 'utf8'));
const saveRec = (id, r) => writeFileSync(recPath(id), JSON.stringify(r, null, 2));
const now = Date.now();
const cmd = process.argv[2];
const arg = (i) => process.argv[i];

async function escrow(id) { return view('get_escrow', { escrow_id: Number(id) }); }
const b0 = (e) => bondOfChain(e);
// The acceptance policy (M5/D2): the same env-driven checks at every point
// where a party accepts an escrow's terms — claiming a job, registering the
// worker's key (the closed-escrow engagement), or opening an engagement
// bundle. Prints the terms, then refuses if a policy bound is violated.
function enforcePolicy(e, what) {
  for (const line of describeTerms(e)) console.log(line);
  const t = termsOfChain(e);
  const pol = [];
  // R11: a non-numeric policy value must fail loudly, never silently disable
  // the check (NaN comparisons are always false).
  const polNum = (name) => {
    const v = process.env[name];
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) { console.error(`acceptance policy env ${name} is not a number: ${v}`); process.exit(2); }
    return n;
  };
  const maxFee = polNum('SEALGATE_MAX_FEE_BPS');
  if (maxFee !== undefined && t.feeBps > maxFee) pol.push(`fee ${t.feeBps} bps exceeds the policy max ${maxFee}`);
  const minW = polNum('SEALGATE_MIN_W_MS');
  if (minW !== undefined && t.wMs < minW) pol.push(`dispute window ${t.wMs} ms below the policy min ${minW}`);
  const minW1 = polNum('SEALGATE_MIN_W1_MS');
  if (minW1 !== undefined && t.w1Ms < minW1) pol.push(`appeal window ${t.w1Ms} ms below the policy min ${minW1}`);
  if (process.env.SEALGATE_MAX_BOND_NEAR) {
    let maxBond;
    try { maxBond = BigInt(parseNearAmount(process.env.SEALGATE_MAX_BOND_NEAR)); }
    catch { console.error(`acceptance policy env SEALGATE_MAX_BOND_NEAR is not a NEAR amount: ${process.env.SEALGATE_MAX_BOND_NEAR}`); process.exit(2); }
    if (b0(e) > maxBond) pol.push(`B0 exceeds the policy max ${process.env.SEALGATE_MAX_BOND_NEAR} NEAR`);
  }
  const minDel = polNum('SEALGATE_MIN_DELIVER_MS');
  if (minDel !== undefined) {
    // Open jobs: the deliver window itself. Closed escrows (R4): the time
    // actually left until deliverBy.
    if (e.open && e.deliverWindow < minDel) pol.push(`deliver window ${e.deliverWindow} ms below the policy min ${minDel}`);
    if (!e.open && e.deliverBy && e.deliverBy - Date.now() < minDel) pol.push(`time left to deliver ${e.deliverBy - Date.now()} ms below the policy min ${minDel}`);
  }
  if (pol.length) { console.error(`${what} refused by the acceptance policy:`, pol.join('; ')); process.exit(2); }
}
// v4 create flags: --bond-bps N --bond-floor NEAR --w-hours H --w1-min M
const flagVal = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
// D1: read the platform's fee schedule BEFORE creating, print it, and pass
// it as max_fee_bps so a schedule change landing first reverts the create
// instead of silently locking the creator into a higher fee. N9: for
// amounts under 0.2 NEAR the legacy 0.05 floor default would exceed the
// 25% cap, so the default floor scales down (never below the 0.01 minimum).
const feeGuardedTermsArgs = async (amountYoctoStr) => {
  const out = termsArgs();
  const sched = await view('get_fee_schedule', {});
  console.log(`platform fee schedule: ${sched.bps / 100}% to ${sched.account}`);
  out.max_fee_bps = flagVal('--max-fee-bps') !== undefined ? Number(flagVal('--max-fee-bps')) : sched.bps;
  if (out.bond_floor === undefined) {
    const amt = BigInt(amountYoctoStr);
    const cap = amt / 4n; const minF = 10n ** 22n; const legacy = 5n * 10n ** 22n;
    const dflt = cap < legacy ? (cap > minF ? cap : minF) : legacy;
    if (dflt !== legacy) { out.bond_floor = dflt.toString(); console.log(`bond floor default scaled to the amount: ${dflt} yocto`); }
  }
  return out;
};
const termsArgs = () => {
  const out = {};
  if (flagVal('--bond-bps') !== undefined) out.bond_bps = Number(flagVal('--bond-bps'));
  if (flagVal('--bond-floor') !== undefined) out.bond_floor = parseNearAmount(flagVal('--bond-floor'));
  if (flagVal('--w-hours') !== undefined) out.w_ms = Math.round(Number(flagVal('--w-hours')) * 3_600_000);
  if (flagVal('--w1-min') !== undefined) out.w1_ms = Math.round(Number(flagVal('--w1-min')) * 60_000);
  return out;
};

// Per-party X25519 keypairs (local files); public keys are registered on-chain per escrow.
const KEYS_DIR = process.env.SEALGATE_KEYS_DIR || '.keys';
const xPath = (party) => `${KEYS_DIR}/x25519-${party}.json`;
const xPathFor = (party, id) => `${KEYS_DIR}/x25519-${party}-${id}.json`;
const loadX = (party) => JSON.parse(readFileSync(xPath(party), 'utf8'));
const loadXFor = (party, id) => existsSync(xPathFor(party, id)) ? JSON.parse(readFileSync(xPathFor(party, id), 'utf8')) : loadX(party);
// The appellate executor's X25519 keypair: its public key is public info (any
// party may seal a bundle to it); the secret is only in the executor's custody.
const execXPub = () => {
  for (const p of [`${KEYS_DIR}/executor-x25519.json`, '.keys/executor-x25519.json']) {
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8')).publicKey;
  }
  throw new Error('executor X25519 public key not found');
};
async function sharedKeyFor(id, myParty) {
  const e = await escrow(id);
  const other = myParty === 'buyer' ? 'worker' : 'buyer';
  const theirPub = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS[other] });
  if (!theirPub) throw new Error(`counterparty key not registered for escrow ${id} (run register-keys)`);
  // Round-5 S4: the local secret must be the key registered on-chain for
  // THIS escrow. Silently falling back to a different (shared/legacy) key
  // produces ciphertext nobody can open — and since round 4 that failure is
  // billed to the party who made it. Stop instead.
  const myPub = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS[myParty] });
  if (!myPub) throw new Error(`my key is not registered for escrow ${id} (run register-keys)`);
  if (getPublicKeyHex(loadXFor(myParty, id).secretKey) !== myPub) throw new Error(`local X25519 key for ${myParty} does not match the key registered on-chain for escrow ${id} — refusing to derive with the wrong key`);
  return deriveKey(loadXFor(myParty, id).secretKey, theirPub, Number(id));
}

if (cmd === 'keys') {
  for (const party of ['buyer', 'worker']) {
    if (!existsSync(xPath(party))) writeFileSync(xPath(party), JSON.stringify(genKeypair()), { mode: 0o600 });
    console.log(party, 'x25519 pubkey:', loadX(party).publicKey);
  }
} else if (cmd === 'register-keys') {
  const id = arg(3);
  const only = arg(4); // optional: register just one party (separate-custody processes)
  for (const party of ['buyer', 'worker']) {
    if (only && party !== only) continue;
    const existing = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS[party] });
    if (existing) { console.log(`${party} key already registered for escrow ${id} (first-write-wins)`); continue; }
    if (party === 'worker') enforcePolicy(await escrow(id), 'worker key registration'); // D2: consent is shown + policy-checked, not mechanical
    // Per-escrow keypair: an appeal hands this escrow's secret to the
    // executor, so keys are never shared across escrows (round-3 N1).
    if (!existsSync(xPathFor(party, id))) writeFileSync(xPathFor(party, id), JSON.stringify(genKeypair()), { mode: 0o600 });
    const eNow = await escrow(id);
    const args = { escrow_id: Number(id), pubkey: loadXFor(party, id).publicKey };
    if (eNow.termsVersion === 2) args.terms_hash = termsHash(eNow); // S6 consent proof
    await call(party, 'register_key', args);
  }
  console.log(only ? `${only} registered its X25519 key for escrow ${id}` : `both parties registered X25519 keys for escrow ${id}`);
} else if (cmd === 'seal-for') {
  // Seal part of MY record to the counterparty's on-chain X25519 key (R5
  // two-agent handoff). Usage: seal-for <id> <engagement|deliverable>
  // (SEALGATE_PARTY says which party this process is.)
  const [id, what] = [arg(3), arg(4)];
  const me = process.env.SEALGATE_PARTY;
  if (me !== 'buyer' && me !== 'worker') { console.error('set SEALGATE_PARTY=buyer|worker'); process.exit(2); }
  const other = me === 'buyer' ? 'worker' : 'buyer';
  const rec = loadRec(id);
  const payload = what === 'engagement' ? { kind: 'engagement', criteria: rec.criteria, salt: rec.salt ?? null, caseType: rec.caseType ?? 'inspection' }
    : what === 'deliverable' ? { kind: 'deliverable', deliverable: rec.deliverable }
    : null;
  if (!payload) { console.error('what must be engagement|deliverable'); process.exit(2); }
  const theirPub = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS[other] });
  if (!theirPub) { console.error(`counterparty key not registered for escrow ${id}`); process.exit(2); }
  mkdirSync('bundles', { recursive: true });
  const file = `bundles/${id}-${what}.json`;
  writeFileSync(file, JSON.stringify(sealBundle({ toPublicHex: theirPub, escrowId: Number(id), payload }), null, 2));
  console.log(`${me} sealed the ${what} for escrow ${id} to ${other} -> ${file}`);
} else if (cmd === 'open-bundle') {
  // Open a bundle sealed to MY X25519 key and merge it into MY record view.
  // A deliverable is accepted only if its salted hash matches the on-chain
  // commitment — the chain, not the sender, is the source of truth.
  const [id, file] = [arg(3), arg(4)];
  const me = process.env.SEALGATE_PARTY;
  if (me !== 'buyer' && me !== 'worker') { console.error('set SEALGATE_PARTY=buyer|worker'); process.exit(2); }
  const data = openBundle({ mySecretHex: loadXFor(me, id).secretKey, bundle: JSON.parse(readFileSync(file, 'utf8')) });
  const rec = existsSync(recPath(id)) ? loadRec(id) : {};
  if (data.kind === 'engagement') {
    // R3: the criteria side is verified against the chain exactly like the
    // deliverable side — a sender-supplied spec that differs from the
    // committed one (or a shifted salt) is rejected, never merged.
    const eNow = await escrow(id);
    const saltErr = validateBundleSalt(data.salt ?? null, eNow.salted ?? (Number(id) >= 6));
    if (saltErr) { console.error(`engagement bundle rejected: ${saltErr}`); process.exit(2); }
    const commit = data.salt ? sha256hex(Buffer.from(`${data.salt}\n${data.criteria}`)) : sha256hex(Buffer.from(data.criteria));
    if (commit !== eNow.criteriaHash) { console.error('engagement bundle rejected: criteria do not match the on-chain commitment'); process.exit(2); }
    if (Buffer.byteLength(data.criteria) > MAX_DELIVERABLE_BYTES) { console.error('engagement bundle rejected: criteria exceed the size cap — this escrow could never be appealed; do not start work on it'); process.exit(2); }
    if ((data.caseType ?? 'inspection') !== (eNow.caseType ?? 'inspection')) { console.error(`engagement bundle rejected: case type '${data.caseType ?? 'inspection'}' does not match the case type fixed on-chain ('${eNow.caseType ?? 'inspection'}')`); process.exit(2); }
    console.log(`engagement case type: ${eNow.caseType ?? 'inspection'} (fixed on-chain at creation)`);
    enforcePolicy(eNow, 'engagement acceptance');
    rec.criteria = data.criteria; rec.salt = data.salt; rec.caseType = data.caseType ?? 'inspection';
    rec.criteriaHash = data.salt ? sha256hex(Buffer.from(`${data.salt}\n${data.criteria}`)) : sha256hex(Buffer.from(data.criteria));
    saveRec(id, rec);
    console.log(`${me} accepted the engagement for escrow ${id} (criteria + salt) into its own record view`);
  } else if (data.kind === 'deliverable') {
    const salt = rec.salt ?? null;
    const hash = salt ? sha256hex(Buffer.from(`${salt}\n${data.deliverable}`)) : sha256hex(Buffer.from(data.deliverable));
    const e = await escrow(id);
    if (hash !== e.deliverableHash) { console.error(`deliverable hash ${hash} does not match the on-chain commitment ${e.deliverableHash} — refusing it`); process.exit(2); }
    // Round-5 S1: the sender's plaintext matching the hash is not enough —
    // the ON-CHAIN ciphertext must also decrypt to the committed record,
    // because that (not the bundle) is what an appeal will recover. A
    // ciphertext only the sender can read makes the delivery defective:
    // refuse it and let the escrow expire rather than inspecting over it.
    if (e.deliverableCipher && me) {
      let key;
      try { key = await sharedKeyFor(id, me); }
      catch { console.error('deliverable bundle: could not derive the escrow key from my registered key — the on-chain ciphertext is unverified, not judged defective; fix key custody or retry'); process.exit(2); }
      try {
        const bytes = decryptDeliverable({ key, escrowId: Number(id), deliverableHash: e.deliverableHash, ciphertextB64: e.deliverableCipher });
        const commit = salt ? sha256hex(Buffer.from(`${salt}\n${bytes.toString('utf8')}`)) : sha256hex(bytes);
        if (commit !== e.deliverableHash) throw new Error('ciphertext content mismatch');
      } catch { console.error('deliverable bundle rejected: the ON-CHAIN deliverable ciphertext cannot be decrypted or does not match its commitment — the delivery is defective; do not inspect it, let the escrow expire'); process.exit(2); }
    }
    rec.deliverable = data.deliverable; rec.deliverableHash = hash;
    saveRec(id, rec);
    console.log(`${me} accepted the deliverable for escrow ${id}: salted hash matches the on-chain commitment`);
  } else { console.error('unknown bundle kind:', data.kind); process.exit(2); }
} else if (cmd === 'decrypt') {
  const [id, party] = [arg(3), arg(4) || 'buyer'];
  const e = await escrow(id);
  const claim = e.claims[e.claims.length - 1];
  let respBytes;
  try {
    const key = await sharedKeyFor(id, party);
    respBytes = decryptResponse({ key, escrowId: Number(id), level: claim.level, respHashHex: claim.respHash, ciphertextB64: claim.encryptedResponse });
  }
  catch {
    // L1 claims posted when the claimant's key was unusable are encrypted
    // under the executor<->appellant key (round-4 R7); the appellant opens
    // those with its own secret and the executor's snapshotted public key.
    if (claim.level !== 1 || !e.dispute || partyOf(e.dispute.by) !== party || !e.appellateExecutorKey) throw new Error('cannot decrypt this claim with the parties key');
    const fb = deriveKey(loadXFor(party, id).secretKey, e.appellateExecutorKey, Number(id));
    respBytes = decryptResponse({ key: fb, escrowId: Number(id), level: 1, respHashHex: claim.respHash, ciphertextB64: claim.encryptedResponse });
  }
  const parsed = parseVerdict(respBytes);
  console.log(`${party} decrypted claim L${claim.level}:`, respBytes.toString('utf8').slice(0, 300));
  console.log('parsed verdict:', JSON.stringify(parsed));
} else if (cmd === 'open-jobs') {
  const jobs = await view('get_open_jobs', {});
  if (!jobs.length) { console.log('no open jobs'); }
  for (const j of jobs) {
    console.log(`job ${j.id}: ${j.amount} yocto by ${j.buyer} · case type ${j.caseType} · claim by ${new Date(j.claimBy).toISOString()}`);
    if (j.feeBps !== undefined) console.log(`  fee ${j.feeBps / 100}% (net on PASS ${j.netOnPass} yocto) · B0 ${j.bond0} yocto · windows dispute ${j.wMs / 1000}s / appeal ${j.w1Ms / 1000}s · appeal fee ${j.appealFee} yocto · terms hash ${j.termsHash}`);
  }
} else if (cmd === 'deposit') {
  const [party, amt] = [arg(3), arg(4)];
  await call(party, 'deposit', {}, BigInt(parseNearAmount(amt)));
  console.log(`${party} deposited ${amt} NEAR; internal balance:`, await view('get_balance', { account: ACCOUNTS[party] }));
} else if (cmd === 'create-open') {
  // Open job (v3 bounty market). Publication of the criteria + salt is the
  // buyer's off-chain choice; on-chain this is the same commitment as ever.
  const criteria = readFileSync(arg(3), 'utf8');
  if (Buffer.byteLength(criteria) > MAX_DELIVERABLE_BYTES) { console.error(`criteria exceed the ${MAX_DELIVERABLE_BYTES}-byte cap — an oversized criteria would make the escrow unappealable (round-5 S2); refusing to create`); process.exit(2); }
  const amount = parseNearAmount(arg(4) || '1');
  const [claimH, deliverH, settleH] = [Number(arg(5)), Number(arg(6)), Number(arg(7))];
  if (!(claimH > 0) || !(deliverH > 0) || !(settleH > 0)) { console.error('usage: create-open <criteriaFile> <near> <claimHours> <deliverHours> <settleHours> [caseType]'); process.exit(2); }
  const caseType = arg(8) && !arg(8).startsWith('--') ? arg(8) : 'inspection';
  if (caseType !== 'inspection' && caseType !== 'adjudication') { console.error('case type must be inspection or adjudication'); process.exit(2); }
  const salt = randomBytes(16).toString('hex');
  const commit = sha256hex(Buffer.from(`${salt}\n${criteria}`));
  const targs = await feeGuardedTermsArgs(amount);
  const id = await call('buyer', 'create_open_escrow', {
    amount, criteria_hash: commit, claim_by: now + claimH * 3_600_000,
    deliver_window: deliverH * 3_600_000, settle_window: settleH * 3_600_000, salted: true, case_type: caseType,
    ...targs,
  }, createStorageDeposit);
  saveRec(id, { criteria, criteriaHash: commit, salt, caseType });
  // M2 readiness: the buyer's response key must exist before anyone may
  // claim (the contract enforces it), so register it as part of posting.
  if (!existsSync(xPathFor('buyer', id))) writeFileSync(xPathFor('buyer', id), JSON.stringify(genKeypair()), { mode: 0o600 });
  const eNew = await escrow(id);
  await call('buyer', 'register_key', { escrow_id: Number(id), pubkey: loadXFor('buyer', id).publicKey, ...(eNew.termsVersion === 2 ? { terms_hash: termsHash(eNew) } : {}) });
  console.log(`open job ${id} created on ${CONTRACT} (case type: ${caseType}); buyer key registered — anyone may claim until the claim deadline`);
  for (const line of describeTerms(eNew)) console.log(line);
  console.log(`to publish this job, share the criteria text and this salt: ${salt}`);
} else if (cmd === 'claim-job') {
  // Claim an open job as the worker. Design review M3: never claim on faith —
  // the published criteria (and salt) must rebuild the on-chain commitment
  // and fit the appealable size cap BEFORE the claim transaction is sent.
  const [id, criteriaFile, saltHex] = [arg(3), arg(4), arg(5)];
  const e = await escrow(id);
  if (!e.open || e.worker) { console.error(`escrow ${id} is not an unclaimed open job`); process.exit(2); }
  const criteria = readFileSync(criteriaFile, 'utf8');
  if (Buffer.byteLength(criteria) > MAX_DELIVERABLE_BYTES) { console.error('claim refused: the published criteria exceed the size cap — this job could never be appealed'); process.exit(2); }
  const salt = e.salted ? (saltHex ?? null) : null;
  if (e.salted && !salt) { console.error('this job uses a salted commitment — pass the published salt as the last argument'); process.exit(2); }
  const commit = salt ? sha256hex(Buffer.from(`${salt}\n${criteria}`)) : sha256hex(Buffer.from(criteria));
  if (commit !== e.criteriaHash) { console.error('claim refused: the published criteria do not match the on-chain commitment (bait-and-switch protection)'); process.exit(2); }
  console.log(`claiming job ${id}: case type ${e.caseType ?? 'inspection'} (fixed on-chain), amount ${e.amount} yocto, claim by ${new Date(e.claimBy).toISOString()}`);
  console.log(`lifecycle if claimed now: deliver within ${e.deliverWindow / 3_600_000}h, settle window ${e.settleWindow / 3_600_000}h (both bound in the terms hash)`);
  // M5: the terms are part of the acceptance. They are printed, checked
  // against this process's acceptance policy (env), and named in the claim
  // transaction itself (S6) — "visible on-chain" is not consent until the
  // claiming client has actually read them.
  enforcePolicy(e, 'claim');
  await call('worker', 'claim_job', { escrow_id: Number(id), ...(e.termsVersion === 2 ? { terms_hash: termsHash(e) } : {}) });
  saveRec(id, { criteria, criteriaHash: commit, salt, caseType: e.caseType ?? 'inspection' });
  console.log(`job ${id} claimed by the worker; next: register-keys ${id} worker (from the worker process), then deliver`);
} else if (cmd === 'create') {
  const criteria = readFileSync(arg(3), 'utf8');
  if (Buffer.byteLength(criteria) > MAX_DELIVERABLE_BYTES) { console.error(`criteria exceed the ${MAX_DELIVERABLE_BYTES}-byte cap — an oversized criteria would make the escrow unappealable (round-5 S2); refusing to create`); process.exit(2); }
  const amount = parseNearAmount(arg(4) || '1');
  // Salted commitments (post-review hardening): the on-chain hashes commit to
  // sha256(salt + "\n" + text); the salt lives only in the parties' record and
  // inside the signed canonical request, so neither hash is dictionary-attackable.
  const salt = randomBytes(16).toString('hex');
  const commit = (text) => sha256hex(Buffer.from(`${salt}\n${text}`));
  const caseType = arg(5) && !arg(5).startsWith('--') ? arg(5) : 'inspection';
  if (caseType !== 'inspection' && caseType !== 'adjudication') { console.error('case type must be inspection or adjudication'); process.exit(2); }
  const targs = await feeGuardedTermsArgs(amount);
  const id = await call('buyer', 'create_escrow', {
    worker: ACCOUNTS.worker, amount, criteria_hash: commit(criteria),
    deliver_by: now + 86_400_000, settle_by: now + 172_800_000, salted: true, case_type: caseType,
    ...targs,
  }, createStorageDeposit);
  saveRec(id, { criteria, criteriaHash: commit(criteria), salt, caseType });
  console.log('escrow created:', id, 'on', CONTRACT, `(case type: ${caseType})`);
  for (const line of describeTerms(await escrow(id))) console.log(line);
} else if (cmd === 'deliver') {
  const [id, file] = [arg(3), arg(4)];
  const deliverable = readFileSync(file, 'utf8');
  const rec = loadRec(id); rec.deliverable = deliverable;
  rec.deliverableHash = rec.salt ? sha256hex(Buffer.from(`${rec.salt}\n${deliverable}`)) : sha256hex(Buffer.from(deliverable));
  const e = await escrow(id);
  if (rec.criteria && Buffer.byteLength(rec.criteria) > MAX_DELIVERABLE_BYTES) { console.error('record criteria exceed the size cap — this escrow could never be appealed (round-5 S2); refusing to deliver'); process.exit(2); }
  // Defense in depth (round-4 R3/R8): never build on a record whose criteria
  // do not match the on-chain commitment, and never submit before both
  // parties' response keys exist (the L0 claim and the deliverable
  // ciphertext both need the shared key).
  const criteriaCommit = rec.salt ? sha256hex(Buffer.from(`${rec.salt}\n${rec.criteria}`)) : sha256hex(Buffer.from(rec.criteria));
  if (criteriaCommit !== e.criteriaHash) { console.error('record criteria do not match the on-chain commitment — refusing to deliver'); process.exit(2); }
  const buyerKey = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS.buyer });
  const workerKey = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS.worker });
  if (!buyerKey || !workerKey) { console.error('both parties must register keys first (register-keys)'); process.exit(2); }
  saveRec(id, rec);
  // R1: the deliverable ciphertext goes ON-CHAIN with the submission, so an
  // appeal never depends on the worker handing the plaintext over later.
  const key = await sharedKeyFor(id, 'worker');
  const cipher = encryptDeliverable({ key, escrowId: Number(id), deliverableHash: rec.deliverableHash, bytes: Buffer.from(deliverable) });
  await call('worker', 'submit_deliverable', { escrow_id: Number(id), deliverable_hash: rec.deliverableHash, encrypted_deliverable: cipher }, storageFor(e, cipher.length));
  console.log('delivered (ciphertext on-chain); escrow:', JSON.stringify(await escrow(id)).slice(0, 160));
} else if (cmd === 'inspect') {
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  // Fable review M-7: refuse early unless an L0 claim can actually post —
  // re-running inspect on a Claimed escrow used to overwrite the local
  // record's signed response with a fresh inference whose post then failed,
  // leaving the record inconsistent with the on-chain claim.
  if (e.phase !== 'Delivered') { console.error(`inspect refused: escrow ${id} is in phase ${e.phase}, not Delivered`); process.exit(2); }
  if (e.deliverableCipher) {
    // Round-5 S1: never post an L0 over a record whose ON-CHAIN deliverable
    // ciphertext is unusable — an appeal would void the claim against the
    // claimant for the worker's defective submission. The shared key is the
    // same from either side, so the first derivable key decides.
    let status = 'unchecked';
    for (const p of ['worker', 'buyer']) {
      try {
        const k = await sharedKeyFor(id, p);
        try {
          const bytes = decryptDeliverable({ key: k, escrowId: Number(id), deliverableHash: e.deliverableHash, ciphertextB64: e.deliverableCipher });
          const c = rec.salt ? sha256hex(Buffer.from(`${rec.salt}\n${bytes.toString('utf8')}`)) : sha256hex(bytes);
          status = c === e.deliverableHash ? 'ok' : 'broken';
        } catch { status = 'broken'; }
        break;
      } catch { /* this party's key is unavailable here; try the other */ }
    }
    if (status === 'broken') { console.error(`inspect refused: the on-chain deliverable ciphertext for escrow ${id} cannot be decrypted or does not match its commitment — posting an L0 claim over it would be voided against the claimant`); process.exit(2); }
  }
  { // R3 defense: the local record must be the committed record.
    const c1 = rec.salt ? sha256hex(Buffer.from(`${rec.salt}\n${rec.criteria}`)) : sha256hex(Buffer.from(rec.criteria));
    const c2 = rec.salt ? sha256hex(Buffer.from(`${rec.salt}\n${rec.deliverable}`)) : sha256hex(Buffer.from(rec.deliverable));
    if (c1 !== e.criteriaHash || c2 !== e.deliverableHash) { console.error('local record does not match the on-chain commitments — refusing to inspect'); process.exit(2); }
  }
  const l0 = await runInspection(KEY, { escrowRef: `${CONTRACT}#${id}`, criteria: rec.criteria, deliverable: rec.deliverable, salt: rec.salt ?? null, caseType: e.caseType ?? 'inspection' });
  // Fable review M-4: the registry is the owner's input — if the model's
  // signer rotated on the provider side and the owner has not registered it
  // yet, posting now would let a dispute void the claim and take the honest
  // claimant's 2xB0 for a failure the claimant does not control. Refuse.
  const registry = await view('get_signers', {});
  const normAddr = (a) => String(a).split(':').pop().toLowerCase().replace(/^0x/, '');
  const registered = new Set(registry.map(normAddr));
  if (!registered.has(normAddr(l0.call.signer))) { console.error(`inspect refused: the L0 signer ${l0.call.signer} is not in the on-chain signer registry — the contract owner must register it before any claim can safely post`); process.exit(2); }
  const poster = l0.verdict === 'PASS' ? 'worker' : 'buyer';
  const key = await sharedKeyFor(id, poster);
  const cipher = encryptResponse({ key, escrowId: Number(id), level: 0, responseBytes: l0.call.respBytes, respHashHex: l0.claim.respHash });
  await call(poster, 'post_claim', {
    escrow_id: Number(id), level: 0, verdict: l0.verdict, req_hash: l0.claim.reqHash, resp_hash: l0.claim.respHash,
    signature: l0.claim.signature, signing_address: l0.claim.signingAddress, signing_algo: l0.claim.signingAlgo, signature_kind: l0.claim.signatureKind,
    encrypted_response: cipher,
    integrity_void: false,
  }, b0(e) + storageFor(e, cipher.length));
  // Save the local record only AFTER the claim is on-chain (M-7): the record
  // must mirror the posted claim, never a response that failed to post.
  rec.l0 = { claim: l0.claim, responseB64: l0.call.respBytes.toString('base64'), chatId: l0.call.chatId, signer: l0.call.signer, ciphertext: cipher };
  saveRec(id, rec);
  console.log(`L0 ${l0.verdict} ("${l0.reason}") claimed by ${poster} on escrow ${id}; on-chain response is ciphertext (${cipher.length} chars)`);
} else if (cmd === 'dispute') {
  const [id, file] = [arg(3), arg(4)]; const rec = loadRec(id); const e = await escrow(id);
  const grounds = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validateGrounds(grounds);
  if (errs.length) { console.error('inadmissible grounds:', errs.join('; ')); process.exit(2); }
  rec.grounds = grounds; saveRec(id, rec);
  const claimant = partyOf(e.claims[e.claims.length - 1].by);
  const disputer = claimant === 'worker' ? 'buyer' : 'worker';
  await call(disputer, 'dispute', { escrow_id: Number(id), grounds_hash: sha256hex(Buffer.from(JSON.stringify(grounds))) }, 2n * b0(e) + BigInt(termsOfChain(e).appealFee));
  console.log(`${disputer} disputed escrow ${id} (appeal funding 2xB0 + the appeal fee posted)`);
} else if (cmd === 'respond') {
  const id = arg(3); const e = await escrow(id);
  const claimant = partyOf(e.claims[0].by);
  await call(claimant, 'respond_dispute', { escrow_id: Number(id) }, b0(e));
  console.log(`${claimant} posted response funding (1xB0) on escrow ${id}`);
} else if (cmd === 'appeal-prepare') {
  // Appellant side of the L1 redesign: seal the record into a bundle only the
  // appellate executor can open, including the escrow's response-encryption
  // key (derived from the appellant's X25519 secret) so the executor can
  // encrypt the L1 response for the two parties.
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  if (!e.dispute) { console.error('no dispute on escrow', id); process.exit(2); }
  const appellant = partyOf(e.dispute.by);
  // The bundle carries the appellant's PER-ESCROW X25519 secret (round-3 N1):
  // the executor verifies it against the on-chain registered key and derives
  // the response key itself, so decryption failure is attributable to the
  // CLAIMANT (whose ciphertext/keys are at fault), never to the bundle.
  // The executor's bundle key is the one SNAPSHOTTED on this escrow (N4);
  // legacy escrows fall back to the live registry, then the local file.
  let execPub = e.appellateExecutorKey || null;
  if (!execPub) { try { const reg = await view('get_appellate_executor', {}); execPub = reg?.x25519_pub || null; } catch { /* fall back to file */ } }
  const bundle = sealBundle({ toPublicHex: execPub || execXPub(), escrowId: Number(id), payload: {
    criteria: rec.criteria, deliverable: rec.deliverable ?? null, salt: rec.salt ?? null, caseType: rec.caseType ?? 'inspection',
    grounds: rec.grounds, appellantSecretHex: (() => {
      // No silent fallback to the shared legacy key here (round-4 R8): the
      // secret leaves this process inside the bundle, so it must be the
      // per-escrow key created by register-keys for THIS escrow.
      if (!existsSync(xPathFor(appellant, id))) { console.error(`no per-escrow key for ${appellant} on escrow ${id} — run register-keys first`); process.exit(2); }
      return JSON.parse(readFileSync(xPathFor(appellant, id), 'utf8')).secretKey;
    })(),
  } });
  mkdirSync('bundles', { recursive: true });
  const file = `bundles/${id}.json`;
  writeFileSync(file, JSON.stringify(bundle, null, 2));
  console.log(`sealed appeal bundle for escrow ${id} -> ${file} (appellant: ${appellant}); hand it to the appellate executor`);
} else if (cmd === 'appeal') {
  // Executor side: ONLY the registered appellate executor may post an L1
  // claim (enforced by the contract). Usage: appeal <id> <bundleFile>.
  const id = arg(3); const bundleFile = arg(4);
  if (!bundleFile) { console.error('usage: appeal <id> <bundleFile> — the appellant seals the record with appeal-prepare; the appellate executor runs the appeal and posts the L1 claim'); process.exit(2); }
  const execX = JSON.parse(readFileSync(`${KEYS_DIR}/executor-x25519.json`, 'utf8'));
  const bundleJson = JSON.parse(readFileSync(bundleFile, 'utf8'));
  if (bundleJson.escrowId !== Number(id)) { console.error(`REFUSING to run the appeal for escrow ${id}: bundle is sealed for escrow ${bundleJson.escrowId}. Nothing was posted.`); process.exit(2); }
  const e = await escrow(id);
  // Operator self-check (round-4 R4, moved before the open in round 5): if
  // this process's executor key is not the key snapshotted on the escrow
  // (rotation, wrong custody), stop loudly BEFORE any state change — a
  // silent open failure here would be billed to the appellant as
  // non-prosecution.
  if (e.appellateExecutorKey && getPublicKeyHex(execX.secretKey) !== e.appellateExecutorKey) {
    console.error(`executor key mismatch: this process does not hold the key snapshotted on escrow ${id}. Nothing was posted.`);
    process.exit(2);
  }
  const data = openBundle({ mySecretHex: execX.secretKey, bundle: bundleJson });
  // F1 (round-2 review): NEVER run the appellate protocol over unverified
  // bundle contents. The appellant seals the bundle, so every field is
  // checked against the on-chain commitments before use, and the L0 response
  // bytes are recovered by decrypting the ON-CHAIN ciphertext (the AEAD AAD
  // binds them to the claim's resp_hash) — not taken from the bundle. Any
  // mismatch means the bundle is not the record of this escrow: refuse to
  // post anything. A tampered bundle must never become a VOID.
  const refuse = (why) => { console.error(`REFUSING to run the appeal for escrow ${id}: ${why}. Nothing was posted.`); process.exit(2); };
  if (data.escrowId !== undefined && data.escrowId !== Number(id)) refuse('bundle escrow id mismatch');
  // N2: the salt encoding must be unambiguous BEFORE any commitment math —
  // a shifted salt passes the hash check but manufactures a VOID downstream.
  const saltErr = validateBundleSalt(data.salt ?? null, e.salted ?? (Number(id) >= 6));
  if (saltErr) refuse(saltErr);
  const commit = (text) => data.salt ? sha256hex(Buffer.from(`${data.salt}\n${text}`)) : sha256hex(Buffer.from(text));
  if (commit(data.criteria) !== e.criteriaHash) refuse('criteria do not match the on-chain commitment');
  // M5: the case type is fixed on-chain; a bundle declaring a different one
  // is not this escrow's record (the appellant controls the bundle, so this
  // refusal bills nobody — nothing is acked).
  if ((data.caseType ?? 'inspection') !== (e.caseType ?? 'inspection')) refuse(`case type '${data.caseType ?? 'inspection'}' does not match the case type fixed on-chain ('${e.caseType ?? 'inspection'}')`);
  // The bundle's deliverable copy is checked when present; since R1 the
  // on-chain ciphertext is the record of truth, so a bundle may carry no
  // deliverable at all (the withholding case) and rely on chain recovery.
  if (data.deliverable != null && commit(data.deliverable) !== e.deliverableHash) refuse('deliverable does not match the on-chain commitment');
  if (data.deliverable == null && !e.deliverableCipher) refuse('no deliverable available (none in the bundle, none on-chain)');
  if (sha256hex(Buffer.from(JSON.stringify(data.grounds))) !== e.dispute.groundsHash) refuse('grounds do not match the on-chain grounds hash');
  // N1: the executor derives the response key ITSELF. The appellant's secret
  // must match their ON-CHAIN registered key (a mismatch is the appellant's
  // fault: refuse). The key is then derived against the CLAIMANT's registered
  // key, so if derivation or decryption fails, the fault is the claimant's
  // (garbage ciphertext, low-order registered key): the claim is VOID,
  // because it is unverifiable by construction — never a silent lapse.
  const appellantParty = partyOf(e.dispute.by);
  const claimantParty = partyOf(e.claims[0].by);
  const appellantPub = appellantParty === 'buyer' ? e.buyerKey : e.workerKey;
  const claimantPub = claimantParty === 'buyer' ? e.buyerKey : e.workerKey;
  if (!appellantPub || !claimantPub) refuse('a party key is missing on-chain');
  let derivedPub = null;
  try { derivedPub = getPublicKeyHex(data.appellantSecretHex); } catch { refuse('appellant secret is not a valid X25519 secret'); }
  if (derivedPub !== appellantPub) refuse('appellant secret does not match the on-chain registered key');
  // R2: EVERY non-AI validation happens BEFORE the ack — grounds
  // admissibility and input sizes included. An ack must mean "a prosecutable
  // appeal was received", so nothing the appellant controls can fail after it.
  const groundsErrs = validateGrounds(data.grounds);
  if (groundsErrs.length) refuse(`inadmissible grounds: ${groundsErrs.join('; ')}`);
  if (Buffer.byteLength(data.criteria) > MAX_DELIVERABLE_BYTES) refuse('criteria exceed the size cap');
  let respKey = null;
  try { respKey = deriveKey(data.appellantSecretHex, claimantPub, Number(id)); } catch { respKey = null; }
  // R1: the deliverable of record is recovered from the ON-CHAIN ciphertext
  // (decrypted with the derived key, hash-checked). A ciphertext that does
  // not decrypt or does not match its commitment is a WORKER-side record
  // failure — the appeal was made impossible by the submission itself.
  // The recovery is only attempted with a valid derived key: when the
  // CLAIMANT's key is unusable (respKey null), the failure is the claimant's
  // and is handled by the l0Undecryptable route — it must not be recorded
  // as a broken deliverable (round-5 S1, attribution follows who controls
  // the input: criteria -> buyer, deliverable ciphertext -> worker, L0
  // ciphertext and keys -> claimant, bundle -> appellant).
  let deliverableText = data.deliverable ?? null; let cipherBroken = false;
  if (e.deliverableCipher && respKey) {
    try {
      const bytes = decryptDeliverable({ key: respKey, escrowId: Number(id), deliverableHash: e.deliverableHash, ciphertextB64: e.deliverableCipher });
      const text = bytes.toString('utf8');
      if (commit(text) !== e.deliverableHash) throw new Error('commitment mismatch');
      deliverableText = text;
    } catch { cipherBroken = true; }
  }
  // S1: a broken deliverable ciphertext is the WORKER's failure. When the
  // worker is the appellant, the appeal is unprosecutable by its own author:
  // refuse BEFORE the ack, so the lapse is attributed to the worker and the
  // claimant's claim stands. (When the worker is the claimant, the same
  // fact is a claimant-side failure and routes to VOID below.)
  if (cipherBroken && appellantParty === 'worker') refuse('the on-chain deliverable ciphertext is unusable and it is the appellant\'s own submission — this failure belongs to the appellant; refusing to ack');
  const deliverableBroken = cipherBroken;
  let l0ResponseBytes = null; let l0Undecryptable = false;
  if (respKey) {
    try { l0ResponseBytes = decryptResponse({ key: respKey, escrowId: Number(id), level: 0, ciphertextB64: e.claims[0].encryptedResponse, respHashHex: e.claims[0].respHash }); }
    catch { l0Undecryptable = true; }
  } else l0Undecryptable = true;
  // The bundle is verified and the appellant has prosecuted: ack on-chain
  // (N3) before any AI stage runs, so any later lapse is attributed to the
  // executor rather than the appellant. The ack may precede funding (R4);
  // if the respondent has not funded yet, receipt is recorded and the
  // protocol waits — re-run this command after funding to continue.
  try { await call('executor', 'ack_bundle', { escrow_id: Number(id) }, 0n); }
  catch (err) { console.error(`appeal on escrow ${id}: ack failed (${String(err.message || err).slice(0, 160)}); nothing else was posted`); process.exit(2); }
  const eNow = await escrow(id);
  if (!eNow.dispute?.funded) { console.log(`appeal on escrow ${id}: bundle verified and acked on-chain; awaiting respondent funding — re-run this command after funding`); process.exit(0); }
  const signers = (await view('get_signers', {})).map((s) => s.split(':')[1]);
  const l0Claim = e.claims[0];
  const res = deliverableBroken
    ? { integrityFailures: ['deliverable ciphertext on-chain cannot be decrypted or does not match its commitment (worker-side record failure)'], outcome: 'VOID', finalVerdict: null, blind: null, comparison: null, l1Claim: null }
    : await runAppeal(KEY, {
      escrowRef: `${CONTRACT}#${id}`, criteria: data.criteria, deliverable: deliverableText, l0Claim,
      l0ResponseBytes, registeredSigners: signers, grounds: data.grounds, salt: data.salt, l0Undecryptable,
      caseType: e.caseType ?? 'inspection',
    });
  let finalVerdict = res.finalVerdict; let l1Claim = res.l1Claim; let l1RespBytes = res.l1ResponseBytes;
  let panelSamples = null; let panelDefault = null; let l1Backing = res.outcome === 'VOID' ? null : 'panel-sample'; // runAppeal backs the L1 claim with the chosen blind sample
  // Mechanism-default backing (round-5 S3): the L0 claim's own signed
  // material, or — when even that cannot be recovered — a short disclosed
  // note. A detected forgery must never win because the AI stages produced
  // nothing postable: the contract does not verify claim content, and the
  // transcript discloses exactly which backing was used.
  const l0Backing = () => {
    if (l0ResponseBytes) return { kind: 'l0-material', claim: { reqHash: l0Claim.reqHash, respHash: l0Claim.respHash, signature: l0Claim.signature, signingAddress: l0Claim.signingAddress, signingAlgo: l0Claim.signingAlgo, signatureKind: l0Claim.signatureKind }, respBytes: l0ResponseBytes };
    const note = Buffer.from(JSON.stringify({ mechanism_default: 'no signed sample available; verdict follows default-overturn semantics (negation of the L0 verdict)' }));
    return { kind: 'mechanism-note', claim: { reqHash: l0Claim.reqHash, respHash: sha256hex(note), signature: l0Claim.signature, signingAddress: l0Claim.signingAddress, signingAlgo: l0Claim.signingAlgo, signatureKind: l0Claim.signatureKind }, respBytes: note };
  };
  if (res.outcome === 'VOID') {
    console.log('integrity failures:', res.integrityFailures.join(' | '));
    const negated = l0Claim.verdict === 'PASS' ? 'FAIL' : 'PASS';
    if (deliverableBroken) {
      // No AI stage is consulted: an unusable deliverable ciphertext is the
      // worker's procedural failure, mechanism-default FAIL (README has
      // claimed exactly this since round 4; round-5 S3 aligns the code).
      finalVerdict = 'FAIL'; panelDefault = 'deliverable-unavailable';
      const b = l0Backing(); l1Claim = b.claim; l1RespBytes = b.respBytes; l1Backing = b.kind;
    } else {
      // Blind panel over the recovered record. Ties and no-quorum resolve
      // to the NEGATION of the L0 verdict (round-5 S3): in the VOID path
      // the L0 verdict is a proven forgery and is never the tiebreak. The
      // judged path in runAppeal keeps the L0 tiebreak (clear-error
      // standard) — that asymmetry is deliberate.
      const samples = [];
      const tryCall = async (model) => {
        try {
          const c = await verifiedCall(KEY, model, buildBlindRequest({ escrowRef: `${CONTRACT}#${id}`, criteria: data.criteria, deliverable: deliverableText ?? '[deliverable unavailable]', salt: data.salt, model, caseType: e.caseType ?? 'inspection' }));
          const pr = parseVerdict(c.respBytes);
          return { call: c, ok: pr.ok, verdict: pr.verdict, model };
        } catch { return { ok: false, model }; }
      };
      for (let i = 0; i < 3; i++) samples.push(await tryCall(MODELS.L1));
      let panel = decidePanel(samples.map((x) => ({ ok: x.ok, verdict: x.verdict })), negated);
      if (!panel) {
        for (let i = 0; i < 2; i++) samples.push(await tryCall(MODELS.L0));
        panel = decidePanel(samples.map((x) => ({ ok: x.ok, verdict: x.verdict })), negated);
      }
      // S6: the transcript records every sample, so the parties can see
      // the panel's composition, abstentions, and which rule decided.
      panelSamples = samples.map((x) => ({ model: x.model, ok: x.ok, verdict: x.verdict ?? null, chatId: x.call?.chatId ?? null, signer: x.call?.signer ?? null }));
      if (panel) {
        const chosen = samples[panel.chosenIndex].call;
        finalVerdict = panel.verdict;
        l1Claim = {
          reqHash: chosen.signature.text.split(':')[1], respHash: chosen.signature.text.split(':')[2],
          signature: chosen.signature.signature, signingAddress: chosen.signature.signing_address,
          signingAlgo: chosen.signature.signing_algo, signatureKind: chosen.signature.signature_kind,
        };
        l1RespBytes = chosen.respBytes; l1Backing = chosen.model === MODELS.L0 ? 'panel-sample-l0-model' : 'panel-sample';
      } else {
        finalVerdict = negated; panelDefault = 'panel-no-quorum';
        const b = l0Backing(); l1Claim = b.claim; l1RespBytes = b.respBytes; l1Backing = b.kind;
      }
    }
  }
  // The L1 response is encrypted under the parties' derived key. If the
  // claimant's registered key was unusable (respKey null), fall back to the
  // executor<->appellant ECDH key (round-4 R7): the appellant can derive it
  // from their own secret and the executor's snapshotted public key; the
  // claimant — who broke their own key — and third parties cannot read it.
  const l1Key = respKey ?? deriveKey(execX.secretKey, appellantPub, Number(id));
  let cipher; let backingOverflow = false;
  try {
    cipher = encryptResponse({ key: l1Key, escrowId: Number(id), level: 1, responseBytes: l1RespBytes, respHashHex: l1Claim.respHash });
  } catch {
    // The backing response exceeds the L1 envelope (round-5 S3): fall back
    // to the mechanism-default backing instead of lapsing after the ack.
    const b = l0Backing(); l1Claim = b.claim; l1RespBytes = b.respBytes; l1Backing = b.kind; backingOverflow = true;
    cipher = encryptResponse({ key: l1Key, escrowId: Number(id), level: 1, responseBytes: l1RespBytes, respHashHex: l1Claim.respHash });
  }
  await call('executor', 'post_claim', {
    escrow_id: Number(id), level: 1, verdict: finalVerdict, req_hash: l1Claim.reqHash, resp_hash: l1Claim.respHash,
    signature: l1Claim.signature, signing_address: l1Claim.signingAddress, signing_algo: l1Claim.signingAlgo, signature_kind: l1Claim.signatureKind,
    encrypted_response: cipher, integrity_void: res.outcome === 'VOID',
  }, storageFor(e, cipher.length)); // the executor posts with no bond (F3: a bond that always returns secures nothing) — only the v5 storage charge for the response ciphertext it stores
  mkdirSync('transcripts', { recursive: true });
  const transcript = { escrowId: Number(id), outcome: res.outcome, finalVerdict, integrityFailures: res.integrityFailures ?? [], blind: res.blind ?? null, comparison: res.comparison ?? null, panelSamples, panelDefault, l1Backing, backingOverflow, postedBy: ACCOUNTS.executor, ackedOnChain: true, l0Undecryptable, deliverableUnavailable: deliverableBroken, l1Encryption: respKey ? 'parties-key' : 'executor-appellant', at: new Date().toISOString() };
  writeFileSync(`transcripts/${id}.appeal.json`, JSON.stringify(transcript, null, 2));
  if (existsSync(`records/${id}.json`)) { const rec = loadRec(id); rec.appeal = { outcome: res.outcome, finalVerdict, postedBy: ACCOUNTS.executor }; saveRec(id, rec); }
  console.log(`appeal on escrow ${id}: outcome=${res.outcome} finalVerdict=${finalVerdict} (L1 claim posted by the appellate executor ${ACCOUNTS.executor}; transcript: transcripts/${id}.appeal.json)`);
} else if (cmd === 'co-sign') {
  const [id, party] = [arg(3), arg(4)];
  await call(party, 'co_sign', { escrow_id: Number(id) });
  console.log(`${party} co-signed escrow ${id}; phase:`, (await escrow(id)).phase);
} else if (cmd === 'finalize') {
  const id = arg(3);
  await call('buyer', 'finalize', { escrow_id: Number(id) });
  console.log('finalized escrow', id, JSON.stringify(await escrow(id)).slice(0, 200));
} else if (cmd === 'prune') {
  // v5: prune a Final escrow's ciphertexts. Each party calls once to
  // consent; execution happens on both consents or after the retention
  // delay (then any caller works — pass any party name).
  const [id, party] = [arg(3), arg(4)];
  if (!party) { console.error('usage: prune <id> <party>'); process.exit(2); }
  const res = await call(party, 'prune', { escrow_id: Number(id) });
  const e = await escrow(id);
  console.log(`prune on escrow ${id} by ${party}: executed=${res?.executed ?? '?'} pruned=${!!e.pruned} consent=[${(e.pruneConsent ?? []).join(', ')}] retainedRent=${e.retainedRent ?? '0'}`);
} else if (cmd === 'show') {
  const id = arg(3); const e = await escrow(id);
  console.log(JSON.stringify(e, null, 1).slice(0, 900));
  for (const line of describeTerms(e)) console.log(line);
  console.log('buyer internal:', await view('get_balance', { account: ACCOUNTS.buyer }), '| worker internal:', await view('get_balance', { account: ACCOUNTS.worker }));
} else if (cmd === 'verify') {
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  const signers = (await view('get_signers', {})).map((s) => s.split(':')[1]);
  const claim = e.claims[e.claims.length - 1];
  const a = verifyIntegrity({ criteria: rec.criteria, deliverable: rec.deliverable, escrowRef: `${CONTRACT}#${id}`, claim, registeredSigners: signers, salt: rec.salt ?? null, caseType: e.caseType ?? 'inspection' });
  let respBytes = claim.level === 0 ? (rec.l0?.responseB64 ? Buffer.from(rec.l0.responseB64, 'base64') : null) : null;
  if (!respBytes && claim.level === 0 && claim.encryptedResponse) {
    // Separate-custody case: this process does not hold the inspector's local
    // response bytes — recover them by decrypting the on-chain ciphertext
    // with this party's own X25519 key (the envelope is addressed to both).
    const party = process.env.SEALGATE_PARTY || 'buyer';
    const key = await sharedKeyFor(id, party);
    respBytes = decryptResponse({ key, escrowId: Number(id), level: 0, ciphertextB64: claim.encryptedResponse, respHashHex: claim.respHash });
  }
  const b = respBytes ? verifyResponseBinding({ claim, responseBytes: respBytes, registeredSigners: signers }) : ['(L1 response binding checked in appeal transcript)'];
  console.log('integrity failures:', JSON.stringify([...a.failures, ...b]));
} else if (cmd === 'receipt') {
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  const signers = await view('get_signers', {});
  const receipt = buildReceipt({ contract: CONTRACT, escrowId: Number(id), record: rec, claims: e.claims, signers, exportedAt: new Date() });
  receipt.caseType = e.caseType ?? 'inspection'; // fixed on-chain at creation (M5); the local record is not authoritative
  // N2: the terms ride along as CONTEXT read from the chain — a judgment
  // earned under weak terms (1% bonds, minimum windows) is worth less as a
  // track record, so a reader should see them; the receipt does not verify
  // them (its scope stays: the model said this about this record).
  receipt.terms = { ...termsOfChain(e), hash: termsHash(e), note: 'context read from the chain at export time; not covered by receipt verification' };
  mkdirSync('receipts', { recursive: true });
  const out = `receipts/${id}.receipt.json`;
  writeFileSync(out, JSON.stringify(receipt, null, 2));
  console.log(`receipt for ${CONTRACT}#${id} written to ${out} (${receipt.claims.length} claim(s), ${receipt.signers.length} signer(s), L0 response ${receipt.responsesByLevel['0'] ? 'included' : 'MISSING'})`);
} else if (cmd === 'verify-receipt') {
  // Two stages: the offline cryptographic check, then — unless --offline —
  // the claim's signer is confirmed against the contract's LIVE signer
  // registry. The registry embedded in a receipt is self-asserted (Fable
  // review M-3): anyone can mint an internally consistent receipt signed by
  // their own key, so the offline stage alone cannot mean "the pinned model
  // said this". --offline keeps the old behavior and says so.
  const file = arg(3);
  const offline = process.argv.includes('--offline');
  let receipt = null; let res;
  try { receipt = JSON.parse(readFileSync(file, 'utf8')); res = verifyReceipt(receipt); }
  catch (err) { res = { ok: false, failures: [`cannot read receipt: ${err.message}`], verdict: null }; }
  if (res.ok && receipt) {
    if (offline) {
      console.log('warning: --offline — signer registry taken from the receipt itself (self-asserted); this VERIFIED means only that the receipt is internally consistent');
    } else {
      try {
        const live = await view('get_signers', {});
        const norm = (a) => String(a).split(':').pop().toLowerCase().replace(/^0x/, '');
        const liveAddrs = new Set(live.map(norm));
        const claim0 = (receipt.claims ?? []).find((c) => c && c.level === 0);
        if (!claim0 || !liveAddrs.has(norm(claim0.signingAddress))) {
          res = { ok: false, failures: [...res.failures, `claim signer ${claim0?.signingAddress} is not in the contract's live signer registry`], verdict: res.verdict };
        }
      } catch (err) { res = { ok: false, failures: [...res.failures, `live signer-registry check failed: ${err.message}`], verdict: res.verdict }; }
    }
  }
  console.log(res.ok ? 'VERIFIED' : 'NOT VERIFIED');
  console.log('verdict:', res.verdict ?? '(none)');
  for (const f of res.failures) console.log('failure:', f);
  console.log('note: VERIFIED binds the signed response to the record and to a signer in the registry (live registry by default; the receipt snapshot only under --offline). It does not by itself prove settlement — contract state and `node scripts/reproduce.mjs` attest that.');
  process.exit(res.ok ? 0 : 1);
} else {
  console.log('commands: keys | open-jobs | register-keys <id> | decrypt <id> <party> | deposit <party> <near> | create <criteriaFile> <near> [caseType] [--bond-bps N] [--bond-floor NEAR] [--w-hours H] [--w1-min M] | create-open <criteriaFile> <near> <claimHours> <deliverHours> <settleHours> [caseType] [same flags] | claim-job <id> <criteriaFile> [saltHex] | deliver <id> <file> | inspect <id> | dispute <id> <groundsFile> | respond <id> | appeal-prepare <id> | appeal <id> <bundleFile> | co-sign <id> <party> | finalize <id> | show <id> | verify <id> | receipt <id> | verify-receipt <file>');
}
