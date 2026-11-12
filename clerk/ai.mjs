// NEAR AI Cloud client implementing the clerk's AI interface (clerk/calls.mjs).
// The verification flow: preflight
// attestation -> completion with the exact request bytes -> response
// signature -> binding checks. Constructed only by the entry point when
// SEALGATE_LIVE=1; the API key comes from NEARAI_API_KEY.
//
// What the signature covers: a provider_tee signature signs
// "<model>:<sha256(request bytes)>:<sha256(response bytes)>". The response
// bytes of a non-streaming completion include the `usage` object
// (prompt_tokens, completion_tokens), so the usage the clerk declares is taken
// from signed bytes. Streaming is never used: a rewritten stream gets a
// `gateway` signature, which the clerk does not count.

import { randomBytes } from 'node:crypto';
import { NEARAI_API } from './config.mjs';
import { sha256hex, normHex, signatureText, verifyTeeSignature } from '../shared/tee.mjs';

export function nearAiCloud({ apiKey, api = NEARAI_API, fetchImpl = globalThis.fetch, verifySignature = verifyTeeSignature, signaturePolls = 6, pollMs = 3000 } = {}) {
  if (!apiKey) throw new Error('NEARAI_API_KEY is not set');
  const auth = { Authorization: `Bearer ${apiKey}` };

  async function preflight(model) {
    const nonce = randomBytes(32).toString('hex');
    const url = `${api}/v1/attestation/report?model=${encodeURIComponent(model)}&provider=near&nonce=${nonce}&signing_algo=ecdsa`;
    const r = await fetchImpl(url, { headers: { 'x-no-aliasing': 'true', ...auth } });
    const j = await r.json();
    if (j.error) throw new Error(`attestation failed: ${j.error.message || JSON.stringify(j.error)}`);
    if (!Array.isArray(j.model_attestations) || j.model_attestations.length === 0) throw new Error('no model_attestations in the preflight report');
    return j.model_attestations;
  }

  return {
    async complete({ model, requestBytes }) {
      const reports = await preflight(model);
      const res = await fetchImpl(`${api}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-no-aliasing': 'true', 'Accept-Encoding': 'identity', ...auth },
        body: Buffer.from(requestBytes),
      });
      const respBytes = new Uint8Array(await res.arrayBuffer());
      if (!res.ok) throw new Error(`completion failed ${res.status}: ${Buffer.from(respBytes).toString('utf8').slice(0, 200)}`);
      const resp = JSON.parse(Buffer.from(respBytes).toString('utf8'));
      if (!resp.id) throw new Error('completion has no id');

      let sig = null;
      for (let i = 0; i < signaturePolls && !sig; i++) {
        const r = await fetchImpl(`${api}/v1/signature/${encodeURIComponent(resp.id)}?signing_algo=ecdsa`, { headers: auth });
        if (r.ok) { const j = await r.json(); if (!j.error_code && !j.error) sig = j; }
        if (!sig) await new Promise((s) => setTimeout(s, pollMs));
      }
      if (!sig) throw new Error('no response signature available; the response is unverified');

      if (sig.signature_kind !== 'provider_tee') throw new Error(`signature_kind is ${sig.signature_kind}, not provider_tee`);
      if (sig.text !== signatureText(model, sha256hex(requestBytes), sha256hex(respBytes))) throw new Error('the signed text does not match the exact request / response bytes');
      const ok = await verifySignature({ text: sig.text, signature: sig.signature, algo: sig.signing_algo, address: sig.signing_address });
      if (!ok) throw new Error('the signature does not verify against its signing_address');
      const matches = reports.filter((r) => normHex(r.signing_address) === normHex(sig.signing_address) && r.signing_algo === sig.signing_algo);
      if (matches.length !== 1) throw new Error('the signer does not match exactly one preflight model attestation');

      return {
        respBytes,
        chatId: resp.id,
        signature: { text: sig.text, signature: sig.signature, signing_algo: sig.signing_algo, signing_address: sig.signing_address, signature_kind: sig.signature_kind },
      };
    },
  };
}
