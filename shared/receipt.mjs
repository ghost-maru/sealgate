// Sealgate shared: portable claim receipt.
// A receipt bundles everything needed to re-run the deterministic integrity stage for
// the level-0 claim offline: the record plaintext, the on-chain claims, a snapshot of the
// signer registry, and the exact signed response bytes. Pure code, no network access.
// The registry inside a receipt is a snapshot from export time and is therefore
// SELF-ASSERTED: verifyReceipt() below proves only internal consistency (this
// response was signed by a key the receipt itself lists, over this record).
// The CLI's verify-receipt adds the live check — the claim's signer must be in
// the contract's current on-chain registry — unless --offline is passed.

import { verifyIntegrity, verifyResponseBinding } from './verify.mjs';

export const RECEIPT_KIND = 'sealgate-receipt';
export const RECEIPT_VERSION = 1;

// Registry entries look like "ecdsa:<address>"; strip the prefix the same way the CLI does.
const signerAddress = (s) => String(s).split(':')[1];

export function buildReceipt({ contract, escrowId, record, claims, signers, exportedAt }) {
  const responsesByLevel = {};
  if (record?.l0?.responseB64) responsesByLevel['0'] = record.l0.responseB64;
  return {
    kind: RECEIPT_KIND,
    version: RECEIPT_VERSION,
    contract: contract ?? null,
    escrowId: escrowId ?? null,
    exportedAt: exportedAt instanceof Date ? exportedAt.toISOString() : (exportedAt ?? new Date().toISOString()),
    criteria: record?.criteria,
    deliverable: record?.deliverable,
    salt: record?.salt ?? null,
    claims: claims || [],
    signers: signers || [],
    responsesByLevel,
  };
}

export function verifyReceipt(receipt) {
  const failures = [];
  if (!receipt || typeof receipt !== 'object') return { ok: false, failures: ['receipt is not an object'], verdict: null };
  if (receipt.kind !== RECEIPT_KIND) failures.push(`kind is ${receipt.kind}, not ${RECEIPT_KIND}`);
  if (receipt.version !== RECEIPT_VERSION) failures.push(`version is ${receipt.version}, not ${RECEIPT_VERSION}`);

  const claim = (Array.isArray(receipt.claims) ? receipt.claims : []).find((c) => c && c.level === 0);
  if (!claim) failures.push('level-0 claim is missing');
  const responseB64 = receipt.responsesByLevel?.['0'];
  if (typeof responseB64 !== 'string' || responseB64.length === 0) failures.push('level-0 response bytes are missing');
  if (typeof receipt.criteria !== 'string') failures.push('criteria is missing');
  if (typeof receipt.deliverable !== 'string') failures.push('deliverable is missing');
  if (!claim || failures.length) return { ok: false, failures, verdict: claim?.verdict ?? null };

  // The request is bound to this escrow; the null (legacy) reference applies only when the
  // receipt carries no escrow identity, so a real escrow's claim cannot pass under it.
  const hasRef = receipt.contract != null && receipt.escrowId != null;
  const escrowRef = hasRef ? `${receipt.contract}#${receipt.escrowId}` : null;
  const registeredSigners = (Array.isArray(receipt.signers) ? receipt.signers : []).map(signerAddress);

  const a = verifyIntegrity({
    criteria: receipt.criteria, deliverable: receipt.deliverable, escrowRef, claim, registeredSigners, salt: receipt.salt ?? null, caseType: receipt.caseType ?? 'inspection',
  });
  failures.push(...a.failures);
  const b = verifyResponseBinding({ claim, responseBytes: Buffer.from(responseB64, 'base64'), registeredSigners });
  failures.push(...b);
  return { ok: failures.length === 0, failures, verdict: claim.verdict ?? null };
}
