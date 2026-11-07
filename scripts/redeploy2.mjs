import { JsonRpcProvider, KeyPairSigner, Account } from 'near-api-js';
import { readFileSync } from 'node:fs';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const APP = 'app2.sealgate-ghost.testnet';
const { secretKey } = JSON.parse(readFileSync('.keys/app2.json', 'utf8'));
const app = new Account(APP, provider, await KeyPairSigner.fromSecretKey(secretKey));
const dep = await app.deployContract(readFileSync('build/sealgate.wasm'));
console.log('redeployed code to', APP, dep?.transaction?.hash || 'ok');
