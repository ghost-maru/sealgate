// One verified model call and the checks of a recorded call.
//
// AI interface (clerk/ai.mjs implements it against NEAR AI Cloud; tests use
// clerk/mock-ai.mjs):
//   ai.complete({ model, requestBytes }) -> Promise<{
//     respBytes: Uint8Array,          the exact response bytes
//     signature: { text, signature, signing_algo, signing_address, signature_kind },
//     chatId?: string }>
//   It throws on transport / provider failure.
//
// Signature verifier interface:
//   verifySignature({ text, signature, algo, address }) -> boolean | Promise<boolean>
//   (shared/tee.mjs verifyTeeSignature in production).
//
// A call counts only if it is fully verifiable from what the record will
// hold: provider_tee signature over "<model>:<req>:<resp>" for the exact bytes,
// a signer registered on the contract, a valid signature, a response that
// parses under the stage's schema (§8.2), and signed usage figures.

import { sha256hex, signatureText, signerKey } from '../shared/tee.mjs';
import { signedUsage } from '../shared/response.mjs';

const asBytes = (b) => (b instanceof Uint8Array ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : new Uint8Array(b));

// Returns { ok: true, reqHash, respHash, respBytes, signature, parsed, usage }
//      or { ok: false, why }.
export async function validatedCall({ ai, model, reqBytes, signers, verifySignature, parse }) {
  let call;
  try {
    call = await ai.complete({ model, requestBytes: reqBytes });
  } catch (e) {
    return { ok: false, why: `model call failed: ${e && e.message ? e.message : e}` };
  }
  if (!call || !call.respBytes || !call.signature) return { ok: false, why: 'model call returned no response or no signature' };
  const respBytes = asBytes(call.respBytes);
  const sig = call.signature;
  const reqHash = sha256hex(reqBytes);
  const respHash = sha256hex(respBytes);
  const failures = signedCallFailures({ model, reqHash, respHash, sig: { kind: sig.signature_kind, algo: sig.signing_algo, addr: sig.signing_address, sig: sig.signature, text: sig.text }, signers });
  if (failures.length) return { ok: false, why: failures.join('; ') };
  let verified = false;
  try { verified = await verifySignature({ text: sig.text, signature: sig.signature, algo: sig.signing_algo, address: sig.signing_address }); } catch { verified = false; }
  if (!verified) return { ok: false, why: 'the TEE signature does not verify' };
  const parsed = parse(respBytes);
  if (!parsed.ok) return { ok: false, why: `invalid response: ${parsed.why}` };
  const usage = signedUsage(respBytes);
  if (!usage) return { ok: false, why: 'the signed response carries no usage figures' };
  return { ok: true, reqHash, respHash, respBytes, signature: sig, parsed, usage, chatId: call.chatId || null };
}

// Structural checks shared by a live call and a recorded call.
// sig: { kind, algo, addr, sig, text? } (text, when given, must equal the expected text)
export function signedCallFailures({ model, reqHash, respHash, sig, signers }) {
  const failures = [];
  if (sig.kind !== 'provider_tee') failures.push(`signature_kind is ${JSON.stringify(sig.kind)}, not provider_tee`);
  if (sig.text !== undefined && sig.text !== signatureText(model, reqHash, respHash)) {
    failures.push('the signed text is not "<model>:<sha256(request)>:<sha256(response)>" for the pinned model and the exact bytes');
  }
  if (!Array.isArray(signers) || !signers.includes(signerKey(sig.algo, sig.addr))) failures.push('the signer is not registered on the contract');
  return failures;
}
