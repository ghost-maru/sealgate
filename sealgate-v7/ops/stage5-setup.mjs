// Sealgate v7 stage 5 (testnet proof) setup. One-time, idempotent where the
// chain allows: creates the contract and clerk accounts via the testnet
// helper, deploys build/sealgate7.wasm, inits with owner = the contract
// account itself, registers the reference clerk + both templates, registers
// the parties' sealing keys, discovers the NEAR AI TEE signing addresses of
// both registered models from real signed calls, and registers those
// signers. Keys are written under .keys/ (mode 600) and never printed.
import { JsonRpcProvider, KeyPairSigner, KeyPair, Account, parseNearAmount } from 'near-api-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { keypair, fromHex, toHex } from '../shared/seal.mjs';
import { REGISTRATION, PRIMARY_MODEL, PANEL_MODEL } from '../clerk/config.mjs';
import { clerkArgs, templateDeposit } from '../clerk/register.mjs';
import { TEMPLATES } from '../clerk/templates.mjs';
import { nearAiCloud } from '../clerk/ai.mjs';

const RPC = 'https://rpc.testnet.near.org';
const provider = new JsonRpcProvider({ url: RPC });
const V5KEYS = new URL('../../sealgate/.keys/', import.meta.url).pathname;
const KEYS = new URL('../.keys/', import.meta.url).pathname;
mkdirSync(KEYS, { recursive: true, mode: 0o700 });

const CONTRACT = process.env.SG7_CONTRACT || 'sealgate7-ghost.testnet';
const CLERK = process.env.SG7_CLERK || 'sealgate7-clerk.testnet';
const R = 'sgbuyer-ghost.testnet';
const S = 'sgworker-ghost.testnet';

const loadJson = (dir, n) => JSON.parse(readFileSync(`${dir}${n}.json`, 'utf8'));
const saveKey = (n, kp) => writeFileSync(`${KEYS}${n}.json`, JSON.stringify({ publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() }), { mode: 0o600 });
const accountFor = async (id, secretKey) => new Account(id, provider, await KeyPairSigner.fromSecretKey(secretKey));
const exists = async (id) => provider.query({ request_type: 'view_account', finality: 'final', account_id: id }).then(() => true).catch(() => false);

async function helperCreate(id, keyName) {
  if (await exists(id)) { console.log(`${id}: already exists`); return accountFor(id, loadJson(KEYS, keyName).secretKey); }
  const kp = KeyPair.fromRandom('ed25519');
  saveKey(keyName, kp);
  const res = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  if (!res.ok) throw new Error(`helper create ${id}: HTTP ${res.status} ${await res.text()}`);
  console.log(`${id}: created via helper`);
  return accountFor(id, kp.toString());
}

const contract = await helperCreate(CONTRACT, 'contract');
const clerk = await helperCreate(CLERK, 'clerk');
const buyer = await accountFor(R, loadJson(V5KEYS, 'buyer').secretKey);
const worker = await accountFor(S, loadJson(V5KEYS, 'worker').secretKey);
for (const [n, a] of [[CONTRACT, contract], [CLERK, clerk], [R, buyer], [S, worker]]) {
  const acc = await provider.query({ request_type: 'view_account', finality: 'final', account_id: n });
  console.log(`${n}: balance ${(BigInt(acc.amount) / 10n ** 21n).toString()} (1e-3 NEAR units)`);
}

// Deploy + init (skip if code already present).
const codeHash = await provider.query({ request_type: 'view_account', finality: 'final', account_id: CONTRACT }).then((a) => a.code_hash);
if (codeHash === '11111111111111111111111111111111') {
  const wasm = readFileSync(new URL('../build/sealgate7.wasm', import.meta.url));
  await contract.deployContract(wasm);
  console.log('wasm deployed');
  await contract.callFunction({ contractId: CONTRACT, methodName: 'init', args: { owner: CONTRACT }, gas: '30000000000000' });
  console.log('init done, owner =', CONTRACT);
} else console.log('contract already deployed, code hash', codeHash.slice(0, 12));

// Clerk sealing key (generate once).
const sealPath = `${KEYS}clerk-seal.key`;
if (!existsSync(sealPath)) {
  const kp = keypair();
  writeFileSync(sealPath, `${toHex(kp.sk)}\n`, { mode: 0o600 });
  console.log('clerk sealing key generated');
}
const clerkSeal = keypair(fromHex(readFileSync(sealPath, 'utf8').trim()));

// Party sealing key files for the CLI (secret hex only), copied from v5's x25519 files.
for (const [name, src] of [['seal-buyer', 'x25519-buyer'], ['seal-worker', 'x25519-worker']]) {
  const p = `${KEYS}${name}.key`;
  if (!existsSync(p)) writeFileSync(p, `${loadJson(V5KEYS, src).secretKey}\n`, { mode: 0o600 });
}

// Register the clerk (owner call) and templates (clerk calls), idempotently.
const view = (method, args) => provider.query({ request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }).then((r) => JSON.parse(Buffer.from(r.result).toString() || 'null'));
if (!(await view('get_clerk', { account: CLERK }))) {
  const args = clerkArgs({ account: CLERK, sealKeyHex: toHex(clerkSeal.pk), feeAccount: CLERK, registration: REGISTRATION });
  await contract.callFunction({ contractId: CONTRACT, methodName: 'register_clerk', args, gas: '100000000000000' });
  console.log('clerk registered');
} else console.log('clerk already registered');
for (const t of TEMPLATES) {
  if (!(await view('get_template', { clerk: CLERK, template_id: t.template_id, version: 1 }))) {
    await clerk.callFunction({ contractId: CONTRACT, methodName: 'register_template', args: { template_id: t.template_id, body: t.body, constraints: t.declarations.constraints, required_inputs: t.declarations.required_inputs }, gas: '100000000000000', deposit: templateDeposit(t) });
    console.log(`template ${t.template_id}@1 registered`);
  } else console.log(`template ${t.template_id}@1 already registered`);
}

// Parties' sealing keys on chain.
for (const [acct, src] of [[buyer, 'x25519-buyer'], [worker, 'x25519-worker']]) {
  const pub = loadJson(V5KEYS, src).publicKey;
  if ((await view('get_key', { account: acct.accountId })) !== pub) {
    await acct.callFunction({ contractId: CONTRACT, methodName: 'register_key', args: { pubkey: pub }, gas: '30000000000000' });
    console.log(`${acct.accountId}: sealing key registered`);
  } else console.log(`${acct.accountId}: sealing key already registered`);
}

// Discover the models' TEE signing addresses from real signed calls, then register them.
const apiKey = process.env.NEARAI_API_KEY;
if (!apiKey) throw new Error('NEARAI_API_KEY is not set');
const ai = nearAiCloud({ apiKey });
const registered = await view('get_signers', {});
for (const model of [PRIMARY_MODEL, PANEL_MODEL]) {
  const reqBytes = new TextEncoder().encode(JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], temperature: 0, max_tokens: 8 }));
  const call = await ai.complete({ model, requestBytes: reqBytes });
  const addr = call.signature.signing_address, algo = call.signature.signing_algo;
  console.log(`${model}: TEE signer ${algo}:${addr.slice(0, 20)}...`);
  if (!registered.some((s) => s.algo === algo && s.address === addr)) {
    await contract.callFunction({ contractId: CONTRACT, methodName: 'register_signer', args: { algo, address: addr }, gas: '30000000000000' });
    console.log('  signer registered');
  } else console.log('  signer already registered');
}
console.log('SETUP COMPLETE', { CONTRACT, CLERK, R, S, PRIMARY_MODEL, PANEL_MODEL });
