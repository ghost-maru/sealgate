import { JsonRpcProvider } from 'near-api-js';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const APP = 'app.sealgate-ghost.testnet';
const all = await provider.query({ request_type: 'view_state', finality: 'final', account_id: APP, prefix_base64: '' });
console.log('total keys:', all.values.length);
for (const v of all.values) {
  const k = Buffer.from(v.key, 'base64');
  const val = Buffer.from(v.value, 'base64').toString('utf8').slice(0, 120);
  console.log(JSON.stringify(k.toString('utf8').slice(0, 40)), '->', JSON.stringify(val));
}
