import { JsonRpcProvider } from 'near-api-js';
const provider = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
for (const id of ['sealgate-ghost.testnet', 'app.sealgate-ghost.testnet', 'sgbuyer-ghost.testnet', 'sgworker-ghost.testnet']) {
  try {
    const r = await provider.query({ request_type: 'view_account', finality: 'final', account_id: id });
    console.log(id, 'EXISTS amount=', r.amount);
  } catch (e) { console.log(id, 'MISSING'); }
}
