// Sealgate CLI core: verified NEAR AI Cloud calls.
// Every call follows the official verification flow (preflight attestation ->
// exact-byte completion -> response signature -> binding checks), so anything this
// module returns has already passed the cryptographic part of the integrity stage.
import { createHash, randomBytes } from 'node:crypto';
import { ethers } from 'ethers';
import nacl from 'tweetnacl';

const API = 'https://cloud-api.near.ai';
const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex');
const normHex = (h) => (h || '').toLowerCase().replace(/^0x/, '');

export async function preflight(apiKey, model) {
  const nonce = randomBytes(32).toString('hex');
  const url = `${API}/v1/attestation/report?model=${encodeURIComponent(model)}&provider=near&nonce=${nonce}&signing_algo=ecdsa`;
  const r = await fetch(url, { headers: { 'x-no-aliasing': 'true', Authorization: `Bearer ${apiKey}` } });
  const j = await r.json();
  if (j.error) throw new Error(`attestation failed: ${j.error.message}`);
  if (!j.model_attestations?.length) throw new Error('no model_attestations in preflight report');
  return j.model_attestations;
}

// Send reqBytes exactly as built; verify the provider_tee signature end to end.
// Returns { respBytes, content, signature: {text, signature, signing_algo, signing_address, signature_kind}, signer }.
export async function verifiedCall(apiKey, model, reqBytes) {
  const reports = await preflight(apiKey, model);
  const compRes = await fetch(`${API}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'x-no-aliasing': 'true', 'Accept-Encoding': 'identity' },
    body: reqBytes,
  });
  const respBytes = Buffer.from(await compRes.arrayBuffer());
  if (!compRes.ok) throw new Error(`completion failed ${compRes.status}: ${respBytes.toString().slice(0, 200)}`);
  const resp = JSON.parse(respBytes.toString('utf8'));

  let sig = null;
  for (let i = 0; i < 6 && !sig; i++) {
    const r = await fetch(`${API}/v1/signature/${resp.id}?signing_algo=ecdsa`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (r.ok) { const j = await r.json(); if (!j.error_code) sig = j; }
    if (!sig) await new Promise((s) => setTimeout(s, 3000));
  }
  if (!sig) throw new Error('no response signature available — treating the response as unverified');

  const expectedText = `${model}:${sha256hex(reqBytes)}:${sha256hex(respBytes)}`;
  if (sig.signature_kind !== 'provider_tee') throw new Error(`signature_kind is ${sig.signature_kind}, not provider_tee`);
  if (sig.text !== expectedText) throw new Error('signature text does not match the exact request/response bytes');
  let ok = false;
  if (sig.signing_algo === 'ecdsa') {
    const recovered = ethers.verifyMessage(Buffer.from(sig.text, 'utf8'), ethers.hexlify('0x' + normHex(sig.signature)));
    ok = normHex(recovered) === normHex(sig.signing_address);
  } else if (sig.signing_algo === 'ed25519') {
    ok = nacl.sign.detached.verify(Buffer.from(sig.text, 'utf8'), Buffer.from(normHex(sig.signature), 'hex'), Buffer.from(normHex(sig.signing_address), 'hex'));
  }
  if (!ok) throw new Error('signature does not verify against its signing_address');
  const matches = reports.filter((r) => normHex(r.signing_address) === normHex(sig.signing_address) && r.signing_algo === sig.signing_algo);
  if (matches.length !== 1) throw new Error('signer does not match exactly one preflight model report');

  return { respBytes, content: resp.choices?.[0]?.message?.content ?? '', chatId: resp.id, signature: sig, signer: sig.signing_address };
}
