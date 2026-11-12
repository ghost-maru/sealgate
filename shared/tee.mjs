// TEE signature handling for NEAR AI Cloud responses (SPEC §8.2, §9.1).
//
// A provider_tee signature signs the text "<model>:<sha256(request bytes)>:<sha256(response bytes)>"
// (hex, lowercase), i.e. the exact request and the exact response bytes.
// The response bytes of a non-streaming chat completion include the `usage`
// object, so the usage figures are covered by the signature.
//
// The contract registry stores signers as "<algo>:<address>" with the address
// lowercased and without 0x (contract/src/kernel/registry.js registerSigner).

import { sha256, toHex, utf8, fromHex } from './seal.mjs';

export const sha256hex = (bytes) => toHex(sha256(bytes));
export const normHex = (h) => String(h || '').toLowerCase().replace(/^0x/, '');
export const signatureText = (model, reqHashHex, respHashHex) => `${model}:${reqHashHex}:${respHashHex}`;
export const signerKey = (algo, address) => `${algo}:${normHex(address)}`;

// Real verifier for the two algorithms NEAR AI Cloud uses. ecdsa is an
// Ethereum personal_sign (EIP-191) signature checked by address recovery
// (ethers, loaded lazily so offline code paths never need it); ed25519 is a
// plain signature under a hex public key.
// sig: { text, signature, algo, address } -> Promise<boolean>
export async function verifyTeeSignature({ text, signature, algo, address }) {
  try {
    if (algo === 'ecdsa') {
      const { ethers } = await import('ethers');
      const recovered = ethers.verifyMessage(utf8(text), '0x' + normHex(signature));
      return normHex(recovered) === normHex(address);
    }
    if (algo === 'ed25519') {
      const { ed25519 } = await import('@noble/curves/ed25519.js');
      return ed25519.verify(fromHex(normHex(signature)), utf8(text), fromHex(normHex(address)));
    }
  } catch {
    return false;
  }
  return false; // any other algorithm (including the test-only "mock") is rejected
}
