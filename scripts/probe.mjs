import { JsonRpcProvider } from 'near-api-js';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const res = await provider.query({ request_type: 'view_account', finality: 'final', account_id: 'sealgate-ghost.testnet' });
console.log('amount(yocto):', res.amount, '≈ NEAR:', Number(BigInt(res.amount) / 10n ** 22n) / 100);
