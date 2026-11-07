import { KeyPair } from 'near-api-js';
import { writeFileSync } from 'node:fs';
const kp = KeyPair.fromRandom('ed25519');
console.log('PUB', kp.getPublicKey().toString());
writeFileSync(process.argv[2] || '/tmp/sg-key.json', JSON.stringify({ publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() }));
