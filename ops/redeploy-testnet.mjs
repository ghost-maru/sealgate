// Redeploy the contract wasm to the existing testnet account and refresh
// the clerk registration (owner = the contract account itself). State is
// preserved: the storage layout does not change between these builds.
// Usage: node ops/redeploy-testnet.mjs
import { JsonRpcProvider, KeyPairSigner, Account } from 'near-api-js';
import { readFileSync } from 'node:fs';
import { keypair, fromHex, toHex } from '../shared/seal.mjs';
import { REGISTRATION } from '../clerk/config.mjs';
import { clerkArgs } from '../clerk/register.mjs';

const RPC = 'https://rpc.testnet.near.org';
const provider = new JsonRpcProvider({ url: RPC });
const CONTRACT = process.env.SG7_CONTRACT || 'sealgate7-ghost.testnet';
const CLERK = process.env.SG7_CLERK || 'sealgate7-clerk.testnet';
const KEYS = new URL('../.keys/', import.meta.url).pathname;
const loadJson = (n) => JSON.parse(readFileSync(`${KEYS}${n}.json`, 'utf8'));
const accountFor = async (id, secretKey) => new Account(id, provider, await KeyPairSigner.fromSecretKey(secretKey));
const view = (method, args) => provider.query({ request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') }).then((r) => JSON.parse(Buffer.from(r.result).toString() || 'null'));

const contract = await accountFor(CONTRACT, loadJson('contract').secretKey);
const before = await provider.query({ request_type: 'view_account', finality: 'final', account_id: CONTRACT });
console.log(`code hash before: ${before.code_hash}`);

const wasm = readFileSync(new URL('../build/sealgate.wasm', import.meta.url));
await contract.deployContract(wasm);
const after = await provider.query({ request_type: 'view_account', finality: 'final', account_id: CONTRACT });
console.log(`code hash after:  ${after.code_hash}`);

// State compatibility: an existing closed case must still read back.
const c0 = await view('get_case', { case_id: 0 });
console.log(`case 0 after redeploy: phase=${c0.phase} verdict=${c0.decision?.verdict}`);

// Refresh the clerk registration (new base fees apply to new cases only).
const clerkSeal = keypair(fromHex(readFileSync(`${KEYS}clerk-seal.key`, 'utf8').trim()));
const args = clerkArgs({ account: CLERK, sealKeyHex: toHex(clerkSeal.pk), feeAccount: CLERK, registration: REGISTRATION });
await contract.callFunction({ contractId: CONTRACT, methodName: 'register_clerk', args, gas: '100000000000000' });
const reg = await view('get_clerk', { account: CLERK });
console.log(`clerk re-registered: base_1=${reg.base1} base_a=${reg.baseA} w1_sec=${reg.w1Sec}`);
console.log('REDEPLOY COMPLETE');
