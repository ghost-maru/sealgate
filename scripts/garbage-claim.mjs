// N1 attack simulation (round-3 review): the claimant posts an L0 claim whose
// signature fields are garbage and whose "encrypted response" is random
// bytes no party key can decrypt. Pre-fix, the executor had to refuse, the
// funded appeal lapsed, and this claim stood. Post-fix, the executor derives
// the response key from the appellant's verified secret, finds the claim
// undecryptable, and posts a VOID (the blind panel still judges the record).
import { randomBytes } from 'node:crypto';
import { account, CONTRACT } from '../cli/chain.mjs';
import { bond0 } from '../contract/machine.mjs';
import { view } from '../cli/chain.mjs';

const id = Number(process.argv[2]);
const e = await view('get_escrow', { escrow_id: id });
const worker = await account('worker');
const hex = (n) => randomBytes(n).toString('hex');
await worker.callFunction({
  contractId: CONTRACT, methodName: 'post_claim',
  args: {
    escrow_id: id, level: 0, verdict: 'PASS', req_hash: hex(32), resp_hash: hex(32),
    signature: hex(64), signing_address: '0x0000000000000000000000000000000000000000',
    signing_algo: 'ecdsa', signature_kind: 'provider_tee',
    encrypted_response: randomBytes(600).toString('base64'), integrity_void: false,
  },
  gas: '30000000000000', deposit: bond0(BigInt(e.amount)),
});
console.log(`garbage L0 claim posted by worker on escrow ${id} (undecryptable ciphertext, fake signature)`);
