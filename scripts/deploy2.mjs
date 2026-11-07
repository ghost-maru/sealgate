// Deploy the v2 bond-schedule contract to a fresh subaccount app2.sealgate-ghost.testnet.
import { JsonRpcProvider, KeyPairSigner, KeyPair, Account, parseNearAmount } from 'near-api-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const ROOT = 'sealgate-ghost.testnet';
const APP = 'app2.sealgate-ghost.testnet';
const load = (n) => JSON.parse(readFileSync(`.keys/${n}.json`, 'utf8'));
const accountFor = async (id, keyFile) => new Account(id, provider, await KeyPairSigner.fromSecretKey(load(keyFile).secretKey));
if (!existsSync('.keys/app2.json')) {
  const kp = KeyPair.fromRandom('ed25519');
  writeFileSync('.keys/app2.json', JSON.stringify({ publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() }), { mode: 0o600 });
}
const root = await accountFor(ROOT, 'root');
const exists = await provider.query({ request_type: 'view_account', finality: 'final', account_id: APP }).then(() => true).catch(() => false);
if (!exists) {
  const { publicKey } = load('app2');
  const r = await root.createSubAccount({ accountOrPrefix: 'app2', publicKey, nearToTransfer: parseNearAmount('7') });
  console.log('created', APP, r?.transaction?.hash || 'ok');
} else console.log(APP, 'already exists');
const app = await accountFor(APP, 'app2');
const dep = await app.deployContract(readFileSync('build/sealgate.wasm'));
console.log('deployed', dep?.transaction?.hash || 'ok');
await app.callFunction({ contractId: APP, methodName: 'init', args: { owner: ROOT }, gas: '30000000000000' });
console.log('init done');
const dry = JSON.parse(readFileSync('dryruns/2026-11-07.json', 'utf8'));
for (const s of [{ algo: 'ecdsa', address: dry.l0.claim.signingAddress }, { algo: 'ecdsa', address: dry.appeal.l1Claim.signingAddress }]) {
  await root.callFunction({ contractId: APP, methodName: 'register_signer', args: s, gas: '30000000000000' });
  console.log('registered signer', s.address.slice(0, 18) + '...');
}
console.log('DEPLOY2 COMPLETE', APP);
