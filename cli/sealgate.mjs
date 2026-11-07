// Sealgate CLI: drives the full v2 protocol against the testnet contract.
// The parties' shared off-chain record lives in records/<escrowId>.json — criteria and
// deliverable plaintext exist ONLY there and in the two parties' hands, never on-chain.
// Usage: node cli/sealgate.mjs <command> ...   (NEARAI_API_KEY in env for AI steps)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parseNearAmount } from 'near-api-js';
import { CONTRACT, ACCOUNTS, view, call, partyOf } from './chain.mjs';
import { bond0 } from '../contract/machine.mjs';
import { sha256hex, verifyIntegrity, verifyResponseBinding, parseVerdict } from '../shared/verify.mjs';
import { buildBlindRequest, MODELS, validateGrounds } from '../shared/templates.mjs';
import { verifiedCall } from './ai.mjs';
import { runInspection, runAppeal } from './appellate.mjs';
import { genKeypair, deriveKey, encryptResponse, decryptResponse } from '../shared/encrypt.mjs';

const KEY = process.env.NEARAI_API_KEY;
const recDir = 'records';
mkdirSync(recDir, { recursive: true });
const recPath = (id) => `${recDir}/${id}.json`;
const loadRec = (id) => JSON.parse(readFileSync(recPath(id), 'utf8'));
const saveRec = (id, r) => writeFileSync(recPath(id), JSON.stringify(r, null, 2));
const now = Date.now();
const cmd = process.argv[2];
const arg = (i) => process.argv[i];

async function escrow(id) { return view('get_escrow', { escrow_id: Number(id) }); }
const b0 = (e) => bond0(BigInt(e.amount));

// Per-party X25519 keypairs (local files); public keys are registered on-chain per escrow.
const xPath = (party) => `.keys/x25519-${party}.json`;
const loadX = (party) => JSON.parse(readFileSync(xPath(party), 'utf8'));
async function sharedKeyFor(id, myParty) {
  const e = await escrow(id);
  const other = myParty === 'buyer' ? 'worker' : 'buyer';
  const theirPub = await view('get_key', { escrow_id: Number(id), account: ACCOUNTS[other] });
  if (!theirPub) throw new Error(`counterparty key not registered for escrow ${id} (run register-keys)`);
  return deriveKey(loadX(myParty).secretKey, theirPub, Number(id));
}

if (cmd === 'keys') {
  for (const party of ['buyer', 'worker']) {
    if (!existsSync(xPath(party))) writeFileSync(xPath(party), JSON.stringify(genKeypair()), { mode: 0o600 });
    console.log(party, 'x25519 pubkey:', loadX(party).publicKey);
  }
} else if (cmd === 'register-keys') {
  const id = arg(3);
  for (const party of ['buyer', 'worker']) {
    await call(party, 'register_key', { escrow_id: Number(id), pubkey: loadX(party).publicKey });
  }
  console.log('both parties registered X25519 keys for escrow', id);
} else if (cmd === 'decrypt') {
  const [id, party] = [arg(3), arg(4) || 'buyer'];
  const e = await escrow(id);
  const claim = e.claims[e.claims.length - 1];
  const key = await sharedKeyFor(id, party);
  const respBytes = decryptResponse({ key, escrowId: Number(id), level: claim.level, respHashHex: claim.respHash, ciphertextB64: claim.encryptedResponse });
  const parsed = parseVerdict(respBytes);
  console.log(`${party} decrypted claim L${claim.level}:`, respBytes.toString('utf8').slice(0, 300));
  console.log('parsed verdict:', JSON.stringify(parsed));
} else if (cmd === 'deposit') {
  const [party, amt] = [arg(3), arg(4)];
  await call(party, 'deposit', {}, BigInt(parseNearAmount(amt)));
  console.log(`${party} deposited ${amt} NEAR; internal balance:`, await view('get_balance', { account: ACCOUNTS[party] }));
} else if (cmd === 'create') {
  const criteria = readFileSync(arg(3), 'utf8');
  const amount = parseNearAmount(arg(4) || '1');
  const id = await call('buyer', 'create_escrow', {
    worker: ACCOUNTS.worker, amount, criteria_hash: sha256hex(Buffer.from(criteria)),
    deliver_by: now + 86_400_000, settle_by: now + 172_800_000,
  });
  saveRec(id, { criteria, criteriaHash: sha256hex(Buffer.from(criteria)) });
  console.log('escrow created:', id, 'on', CONTRACT);
} else if (cmd === 'deliver') {
  const [id, file] = [arg(3), arg(4)];
  const deliverable = readFileSync(file, 'utf8');
  const rec = loadRec(id); rec.deliverable = deliverable; rec.deliverableHash = sha256hex(Buffer.from(deliverable)); saveRec(id, rec);
  await call('worker', 'submit_deliverable', { escrow_id: Number(id), deliverable_hash: rec.deliverableHash });
  console.log('delivered; escrow:', JSON.stringify(await escrow(id)).slice(0, 160));
} else if (cmd === 'inspect') {
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  const l0 = await runInspection(KEY, { escrowRef: `${CONTRACT}#${id}`, criteria: rec.criteria, deliverable: rec.deliverable });
  rec.l0 = { claim: l0.claim, responseB64: l0.call.respBytes.toString('base64'), chatId: l0.call.chatId, signer: l0.call.signer };
  saveRec(id, rec);
  const poster = l0.verdict === 'PASS' ? 'worker' : 'buyer';
  const key = await sharedKeyFor(id, poster);
  const cipher = encryptResponse({ key, escrowId: Number(id), level: 0, responseBytes: l0.call.respBytes, respHashHex: l0.claim.respHash });
  rec.l0.ciphertext = cipher; saveRec(id, rec);
  await call(poster, 'post_claim', {
    escrow_id: Number(id), level: 0, verdict: l0.verdict, req_hash: l0.claim.reqHash, resp_hash: l0.claim.respHash,
    signature: l0.claim.signature, signing_address: l0.claim.signingAddress, signing_algo: l0.claim.signingAlgo, signature_kind: l0.claim.signatureKind,
    encrypted_response: cipher,
    integrity_void: false,
  }, b0(e));
  console.log(`L0 ${l0.verdict} ("${l0.reason}") claimed by ${poster} on escrow ${id}; on-chain response is ciphertext (${cipher.length} chars)`);
} else if (cmd === 'dispute') {
  const [id, file] = [arg(3), arg(4)]; const rec = loadRec(id); const e = await escrow(id);
  const grounds = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validateGrounds(grounds);
  if (errs.length) { console.error('inadmissible grounds:', errs.join('; ')); process.exit(2); }
  rec.grounds = grounds; saveRec(id, rec);
  const claimant = partyOf(e.claims[e.claims.length - 1].by);
  const disputer = claimant === 'worker' ? 'buyer' : 'worker';
  await call(disputer, 'dispute', { escrow_id: Number(id), grounds_hash: sha256hex(Buffer.from(JSON.stringify(grounds))) }, 2n * b0(e));
  console.log(`${disputer} disputed escrow ${id} (appeal funding 2xB0 posted)`);
} else if (cmd === 'respond') {
  const id = arg(3); const e = await escrow(id);
  const claimant = partyOf(e.claims[0].by);
  await call(claimant, 'respond_dispute', { escrow_id: Number(id) }, b0(e));
  console.log(`${claimant} posted response funding (1xB0) on escrow ${id}`);
} else if (cmd === 'appeal') {
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  const signers = (await view('get_signers', {})).map((s) => s.split(':')[1]);
  const l0Claim = e.claims[0];
  const res = await runAppeal(KEY, {
    escrowRef: `${CONTRACT}#${id}`, criteria: rec.criteria, deliverable: rec.deliverable, l0Claim,
    l0ResponseBytes: Buffer.from(rec.l0.responseB64, 'base64'), registeredSigners: signers, grounds: rec.grounds,
  });
  let finalVerdict = res.finalVerdict; let l1Claim = res.l1Claim; let l1RespBytes = res.l1ResponseBytes;
  if (res.outcome === 'VOID') {
    // Integrity failure: the appellate verdict comes from a blind judgment of the true record.
    const blind = await verifiedCall(KEY, MODELS.L1, buildBlindRequest({ escrowRef: `${CONTRACT}#${id}`, criteria: rec.criteria, deliverable: rec.deliverable }));
    const parsed = parseVerdict(blind.respBytes);
    finalVerdict = parsed.verdict;
    l1RespBytes = blind.respBytes;
    l1Claim = {
      reqHash: blind.signature.text.split(':')[1], respHash: blind.signature.text.split(':')[2],
      signature: blind.signature.signature, signingAddress: blind.signature.signing_address,
      signingAlgo: blind.signature.signing_algo, signatureKind: blind.signature.signature_kind,
    };
    console.log('integrity failures:', res.integrityFailures.join(' | '));
  }
  rec.appeal = { outcome: res.outcome, finalVerdict, comparison: res.comparison, blind: res.blind }; saveRec(id, rec);
  const appellant = partyOf(e.dispute.by);
  const key = await sharedKeyFor(id, appellant);
  const cipher = encryptResponse({ key, escrowId: Number(id), level: 1, responseBytes: l1RespBytes, respHashHex: l1Claim.respHash });
  await call(appellant, 'post_claim', {
    escrow_id: Number(id), level: 1, verdict: finalVerdict, req_hash: l1Claim.reqHash, resp_hash: l1Claim.respHash,
    signature: l1Claim.signature, signing_address: l1Claim.signingAddress, signing_algo: l1Claim.signingAlgo, signature_kind: l1Claim.signatureKind,
    encrypted_response: cipher, integrity_void: res.outcome === 'VOID',
  }, b0(e));
  console.log(`appeal on escrow ${id}: outcome=${res.outcome} finalVerdict=${finalVerdict} (L1 claim posted by ${appellant})`);
} else if (cmd === 'co-sign') {
  const [id, party] = [arg(3), arg(4)];
  await call(party, 'co_sign', { escrow_id: Number(id) });
  console.log(`${party} co-signed escrow ${id}; phase:`, (await escrow(id)).phase);
} else if (cmd === 'finalize') {
  const id = arg(3);
  await call('buyer', 'finalize', { escrow_id: Number(id) });
  console.log('finalized escrow', id, JSON.stringify(await escrow(id)).slice(0, 200));
} else if (cmd === 'show') {
  const id = arg(3); const e = await escrow(id);
  console.log(JSON.stringify(e, null, 1).slice(0, 900));
  console.log('buyer internal:', await view('get_balance', { account: ACCOUNTS.buyer }), '| worker internal:', await view('get_balance', { account: ACCOUNTS.worker }));
} else if (cmd === 'verify') {
  const id = arg(3); const rec = loadRec(id); const e = await escrow(id);
  const signers = (await view('get_signers', {})).map((s) => s.split(':')[1]);
  const claim = e.claims[e.claims.length - 1];
  const a = verifyIntegrity({ criteria: rec.criteria, deliverable: rec.deliverable, escrowRef: `${CONTRACT}#${id}`, claim, registeredSigners: signers });
  const respBytes = claim.level === 0 ? Buffer.from(rec.l0.responseB64, 'base64') : null;
  const b = respBytes ? verifyResponseBinding({ claim, responseBytes: respBytes, registeredSigners: signers }) : ['(L1 response binding checked in appeal transcript)'];
  console.log('integrity failures:', JSON.stringify([...a.failures, ...b]));
} else {
  console.log('commands: keys | register-keys <id> | decrypt <id> <party> | deposit <party> <near> | create <criteriaFile> <near> | deliver <id> <file> | inspect <id> | dispute <id> <groundsFile> | respond <id> | appeal <id> | co-sign <id> <party> | finalize <id> | show <id> | verify <id>');
}
