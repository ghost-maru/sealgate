// DEPRECATED (v4): this one-off script predates the declared-W1-range
// requirement. It passes only { account } to set_appellate_executor, which
// now reverts on an account change without the key + range. Kept for the
// account-creation half only; use scripts/setup-v4.mjs for registration.
// One-off setup (2026-11-09, L1 redesign): create the appellate-executor
// account as a subaccount of the root account, save its key to
// .keys/executor.json (600), and register it on the contract as the sole
// account allowed to post L1 claims.
import { JsonRpcProvider, KeyPairSigner, Account, KeyPairEd25519 } from 'near-api-js';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

const ROOT_ID = 'sealgate-ghost.testnet';
const NEW_ID = 'appeal.sealgate-ghost.testnet';
const CONTRACT = 'app2.sealgate-ghost.testnet';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });

const { secretKey } = JSON.parse(readFileSync('.keys/root.json', 'utf8'));
const root = new Account(ROOT_ID, provider, await KeyPairSigner.fromSecretKey(secretKey));

const kp = KeyPairEd25519.fromRandom();
writeFileSync('.keys/executor.json', JSON.stringify({ accountId: NEW_ID, publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() }, null, 2));
chmodSync('.keys/executor.json', 0o600);
console.log('executor keypair generated:', kp.getPublicKey().toString());

// Create the subaccount with the native transaction actions.
await root.createSubAccount({ accountOrPrefix: 'appeal', publicKey: kp.getPublicKey(), nearToTransfer: 350000000000000000000000n }); // 0.35 NEAR
console.log('created', NEW_ID);

// Owner registers the executor on the contract.
await root.callFunction({
  contractId: CONTRACT, methodName: 'set_appellate_executor',
  args: { account: NEW_ID }, gas: '30000000000000', deposit: 0n,
});
console.log('registered as appellate executor on', CONTRACT);
