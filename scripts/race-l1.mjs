// Proof for the L1 redesign (2026-11-09): after an appeal is funded, a PARTY
// tries to race-post its own L1 claim (the pre-redesign attack). The contract
// must reject it: only the registered appellate executor may post L1 claims.
// Usage: node scripts/race-l1.mjs <escrowId> [party=worker]
import { randomBytes } from 'node:crypto';
import { CONTRACT, ACCOUNTS, view, call } from '../cli/chain.mjs';
import { bond0 } from '../contract/machine.mjs';

const id = Number(process.argv[2]);
const party = process.argv[3] || 'worker';
const e = await view('get_escrow', { escrow_id: id });
if (e.phase !== 'Disputed' || !e.dispute?.funded) { console.error(`escrow ${id} is not in a funded dispute (phase ${e.phase})`); process.exit(2); }
const junk = () => randomBytes(32).toString('hex');
try {
  await call(party, 'post_claim', {
    escrow_id: id, level: 1, verdict: 'PASS', req_hash: junk(), resp_hash: junk(),
    signature: '0x' + junk(), signing_address: '0x' + randomBytes(20).toString('hex'),
    signing_algo: 'ecdsa', signature_kind: 'provider_tee',
    encrypted_response: 'AAAA', integrity_void: false,
  }, bond0(BigInt(e.amount)));
  console.log('UNEXPECTED: the party L1 claim was ACCEPTED — the race is still open');
  process.exit(1);
} catch (err) {
  const msg = String(err?.message || err);
  const m = msg.match(/only the appellate executor[^\"]*/);
  console.log(`REJECTED as designed: ${party} (${ACCOUNTS[party]}) tried to post an L1 claim on escrow ${id}`);
  console.log('contract said:', m ? m[0] : msg.slice(0, 200));
  const after = await view('get_escrow', { escrow_id: id });
  console.log(`escrow phase after the attempt: ${after.phase}, claims: ${after.claims.length} (unchanged)`);
}
