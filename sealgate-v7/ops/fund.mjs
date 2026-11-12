import { JsonRpcProvider, KeyPairSigner, Account, parseNearAmount } from 'near-api-js';
import { readFileSync } from 'node:fs';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const { secretKey } = JSON.parse(readFileSync('.keys/contract.json', 'utf8'));
const from = new Account('sealgate7-ghost.testnet', provider, await KeyPairSigner.fromSecretKey(secretKey));
for (const to of ['sgbuyer-ghost.testnet', 'sgworker-ghost.testnet']) {
  const r = await from.transfer({ receiverId: to, amount: parseNearAmount('2') });
  console.log(`funded ${to} with 2 NEAR`, r?.transaction?.hash || 'ok');
}
