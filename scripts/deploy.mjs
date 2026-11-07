// One-time testnet setup: subaccount for the contract, helper-created buyer/worker
// accounts, contract deployment + init + signer registration.
// Keys land in .keys/ (mode 600). Reruns are NOT idempotent by design.
import { JsonRpcProvider, KeyPairSigner, KeyPair, Account, parseNearAmount } from 'near-api-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const RPC = 'https://rpc.testnet.near.org';
const provider = new JsonRpcProvider({ url: RPC });
const ROOT = 'sealgate-ghost.testnet';
const APP = 'app.sealgate-ghost.testnet';
const BUYER = 'sgbuyer-ghost.testnet';
const WORKER = 'sgworker-ghost.testnet';
const load = (n) => JSON.parse(readFileSync(`.keys/${n}.json`, 'utf8'));
const save = (n, kp) => { writeFileSync(`.keys/${n}.json`, JSON.stringify({ publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() }), { mode: 0o600 }); };
const accountFor = async (id, keyFile) => {
  const { secretKey } = load(keyFile);
  const signer = await KeyPairSigner.fromSecretKey(secretKey);
  return new Account(id, provider, signer);
};

const root = await accountFor(ROOT, 'root');
console.log('root balance:', (await provider.query({ request_type: 'view_account', finality: 'final', account_id: ROOT })).amount);

// 1. Contract subaccount (8.5 NEAR: ~5.6 for code storage + state + headroom)
if (!existsSync('.keys/app.json')) { const kp0 = KeyPair.fromRandom('ed25519'); save('app', kp0); }
{
  const { publicKey } = load('app');
  const exists = await provider.query({ request_type: 'view_account', finality: 'final', account_id: APP }).then(() => true).catch(() => false);
  if (!exists) {
    const r = await root.createSubAccount({ accountOrPrefix: 'app', publicKey, nearToTransfer: parseNearAmount('8.5') });
    console.log('created', APP, r?.transaction?.hash || 'ok');
  } else console.log(APP, 'already exists');
}
const app = await accountFor(APP, 'app');

// 2. Buyer / worker via the testnet helper (10 NEAR each)
async function helperCreate(id, keyName) {
  if (existsSync(`.keys/${keyName}.json`)) return;
  const kp = KeyPair.fromRandom('ed25519'); save(keyName, kp);
  const res = await fetch('https://helper.testnet.near.org/account', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
  });
  const j = await res.json();
  console.log('helper created', id, j.final_execution_status || JSON.stringify(j).slice(0, 120));
}
await helperCreate(BUYER, 'buyer');
await helperCreate(WORKER, 'worker');
const buyer = await accountFor(BUYER, 'buyer');
const worker = await accountFor(WORKER, 'worker');
console.log('buyer balance:', (await provider.query({ request_type: 'view_account', finality: 'final', account_id: BUYER })).amount);
console.log('worker balance:', (await provider.query({ request_type: 'view_account', finality: 'final', account_id: WORKER })).amount);

// 3. Deploy + init
const wasm = readFileSync('build/sealgate.wasm');
const dep = await app.deployContract(wasm);
console.log('deployed to', APP, dep?.transaction?.hash || 'ok');
const init = await app.callFunction({ contractId: APP, methodName: 'init', args: { owner: ROOT }, gas: '30000000000000' });
console.log('init done', init?.transaction?.hash || 'ok');

// 4. Register the spike-verified model signers (owner call)
const rootAcc = root;
const dry = JSON.parse(readFileSync('dryruns/2026-11-07.json', 'utf8'));
const signers = [
  { algo: 'ecdsa', address: dry.l0.claim.signingAddress },
  { algo: 'ecdsa', address: dry.appeal.l1Claim.signingAddress },
];
for (const s of signers) {
  await rootAcc.callFunction({ contractId: APP, methodName: 'register_signer', args: s, gas: '30000000000000' });
  console.log('registered signer', s.address.slice(0, 18) + '...');
}
const list = await app.callFunction({ contractId: APP, methodName: 'get_signers', args: {} }).catch(() => null);
console.log('signers view (via call fallback):', list ? 'see explorer' : 'skip');
console.log('SETUP COMPLETE', { APP, BUYER, WORKER, ROOT });
