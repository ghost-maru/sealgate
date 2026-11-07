import { JsonRpcProvider, KeyPairSigner, Account } from 'near-api-js';
import { readFileSync } from 'node:fs';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const { secretKey } = JSON.parse(readFileSync('.keys/root.json', 'utf8'));
const signer = await KeyPairSigner.fromSecretKey(secretKey);
const acc = new Account('sealgate-ghost.testnet', provider, signer);
const b = await acc.getBalance();
console.log(JSON.stringify(b, (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v), 1).slice(0, 400));
