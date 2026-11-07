import { JsonRpcProvider, KeyPairSigner, Account, actions, parseNearAmount } from 'near-api-js';
import { readFileSync } from 'node:fs';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const { secretKey } = JSON.parse(readFileSync('.keys/worker.json', 'utf8'));
const worker = new Account('sgworker-ghost.testnet', provider, await KeyPairSigner.fromSecretKey(secretKey));
const r = await worker.signAndSendTransaction({ receiverId: 'sealgate-ghost.testnet', actions: [actions.transfer(BigInt(parseNearAmount('6')))] });
console.log('transfer done:', JSON.stringify(r?.transaction?.hash || r).slice(0, 60));
const root = await provider.query({ request_type: 'view_account', finality: 'final', account_id: 'sealgate-ghost.testnet' });
console.log('root balance now:', root.amount);
