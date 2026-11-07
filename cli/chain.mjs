// Sealgate chain access layer: accounts, views, and calls against the deployed
// contract. Contract id from SEALGATE_CONTRACT (default app2 deployment).
// NOTE: this near-api-js version takes `deposit` (BigInt) on callFunction —
// the legacy `attachedDeposit` key is silently ignored.
import { JsonRpcProvider, KeyPairSigner, Account } from 'near-api-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACT = process.env.SEALGATE_CONTRACT || 'app2.sealgate-ghost.testnet';
export const ACCOUNTS = {
  root: 'sealgate-ghost.testnet',
  buyer: 'sgbuyer-ghost.testnet',
  worker: 'sgworker-ghost.testnet',
};
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const cache = {};
export async function account(party) {
  if (!cache[party]) {
    const { secretKey } = JSON.parse(readFileSync(join(ROOT, '.keys', `${party}.json`), 'utf8'));
    cache[party] = new Account(ACCOUNTS[party], provider, await KeyPairSigner.fromSecretKey(secretKey));
  }
  return cache[party];
}
export async function view(method, args = {}) {
  const r = await provider.query({
    request_type: 'call_function', finality: 'final', account_id: CONTRACT,
    method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
  });
  return JSON.parse(Buffer.from(r.result).toString('utf8'));
}
export async function call(party, method, args, deposit = 0n) {
  const acc = await account(party);
  return acc.callFunction({ contractId: CONTRACT, methodName: method, args, gas: '100000000000000', deposit: BigInt(deposit) });
}
export const partyOf = (accountId) => Object.entries(ACCOUNTS).find(([, id]) => id === accountId)?.[0];
