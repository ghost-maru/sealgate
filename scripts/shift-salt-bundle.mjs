// N2 attack simulation (round-3 review): the appellant shifts the salt into
// the record body — salt: null, criteria' = "<salt>\n<criteria>", deliverable'
// likewise. The unsalted hash of the shifted text equals the salted on-chain
// commitment, so a naive commitment check PASSES, but the canonical request
// no longer rebuilds and an honest claim would be manufactured into a VOID.
// The executor must REFUSE on the salt encoding before any commitment math.
import { readFileSync, writeFileSync } from 'node:fs';
import { sealBundle, openBundle } from '../cli/bundle.mjs';

const id = process.argv[2];
const execX = JSON.parse(readFileSync('.keys/executor-x25519.json', 'utf8'));
const honest = openBundle({ mySecretHex: execX.secretKey, bundle: JSON.parse(readFileSync(`bundles/${id}.json`, 'utf8')) });
if (!honest.salt) { console.error('escrow bundle has no salt to shift'); process.exit(1); }
const shifted = {
  ...honest, salt: null,
  criteria: `${honest.salt}\n${honest.criteria}`,
  deliverable: `${honest.salt}\n${honest.deliverable}`,
};
const file = `bundles/${id}-saltshift.json`;
writeFileSync(file, JSON.stringify(sealBundle({ toPublicHex: execX.publicKey, escrowId: Number(id), payload: shifted }), null, 2));
console.log(`salt-shifted bundle written to ${file}`);
