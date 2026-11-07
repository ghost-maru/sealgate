// On-chain smoke test: deposit -> create_escrow -> submit_deliverable -> view.
import { JsonRpcProvider, KeyPairSigner, Account, parseNearAmount } from 'near-api-js';
import { readFileSync } from 'node:fs';

const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const APP = 'app.sealgate-ghost.testnet';
const BUYER = 'sgbuyer-ghost.testnet';
const WORKER = 'sgworker-ghost.testnet';
const accountFor = async (id, keyFile) => {
  const { secretKey } = JSON.parse(readFileSync(`.keys/${keyFile}.json`, 'utf8'));
  return new Account(id, provider, await KeyPairSigner.fromSecretKey(secretKey));
};
const view = async (method, args) => {
  const r = await provider.query({ request_type: 'call_function', finality: 'final', account_id: APP, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  return JSON.parse(Buffer.from(r.result).toString('utf8'));
};

console.log('signers:', await view('get_signers', {}));
console.log('escrow_count:', await view('escrow_count', {}));

const buyer = await accountFor(BUYER, 'buyer');
const worker = await accountFor(WORKER, 'worker');
const GAS = '100000000000000';
await buyer.callFunction({ contractId: APP, methodName: 'deposit', args: {}, gas: GAS, deposit: BigInt(parseNearAmount('2')) });
console.log('buyer deposited 2 NEAR; balance view:', await view('get_balance', { account: BUYER }));

const now = Date.now();
const created = await buyer.callFunction({
  contractId: APP, methodName: 'create_escrow', gas: GAS,
  args: { worker: WORKER, amount: parseNearAmount('1'), criteria_hash: 'c'.repeat(64), deliver_by: now + 3_600_000, settle_by: now + 86_400_000 },
});
console.log('create_escrow result:', JSON.stringify(created?.transaction?.hash || created).slice(0, 80));
const id = (await view('escrow_count', {})) - 1;
console.log('escrow id:', id, JSON.stringify(await view('get_escrow', { escrow_id: id })).slice(0, 220));

await worker.callFunction({ contractId: APP, methodName: 'submit_deliverable', args: { escrow_id: id, deliverable_hash: 'd'.repeat(64) }, gas: GAS });
const after = await view('get_escrow', { escrow_id: id });
console.log('after deliver: phase =', after.phase, '| deliverableHash set:', !!after.deliverableHash);
console.log('SMOKE OK');
