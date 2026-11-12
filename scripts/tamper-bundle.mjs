// F1 attack simulation (round-2 review): a malicious appellant seals a bundle
// whose record does NOT match the escrow's on-chain commitments (here: the
// deliverable has one trailing space added — enough to break the salted hash).
// The executor must REFUSE to run the appeal and post nothing; under the
// pre-fix code this bundle would have produced a guaranteed VOID and paid the
// appellant the claimant's bonds.
import { readFileSync, writeFileSync } from 'node:fs';
import { sealBundle, openBundle } from '../cli/bundle.mjs';

const id = process.argv[2];
const execX = JSON.parse(readFileSync('.keys/executor-x25519.json', 'utf8'));
const honest = openBundle({ mySecretHex: execX.secretKey, bundle: JSON.parse(readFileSync(`bundles/${id}.json`, 'utf8')) });
const tampered = { ...honest, deliverable: honest.deliverable + ' ' };
const file = `bundles/${id}-tampered.json`;
writeFileSync(file, JSON.stringify(sealBundle({ toPublicHex: execX.publicKey, escrowId: Number(id), payload: tampered }), null, 2));
console.log(`tampered bundle written to ${file} (deliverable altered by one trailing space)`);
