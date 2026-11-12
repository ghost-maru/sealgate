// Read a case's primary reason as the requester (K1 from env_r + seal key).
// Usage: node ops/read-reason.mjs <case_id>
import { JsonRpcProvider } from 'near-api-js';
import { readFileSync } from 'node:fs';
import { fromB64, fromHex, open, dec, ctxOf, LABELS } from '../shared/seal.mjs';
import { decodeRecord, payloadSlice, inflate } from '../shared/record.mjs';
import { parseVerdictResponse } from '../shared/response.mjs';

const CONTRACT = 'sealgate7-ghost.testnet';
const caseId = Number(process.argv[2]);
const p = new JsonRpcProvider({ url: 'https://rpc.testnet.near.org' });
const view = (m, a) => p.query({ request_type: 'call_function', finality: 'final', account_id: CONTRACT, method_name: m, args_base64: Buffer.from(JSON.stringify(a)).toString('base64') }).then((r) => JSON.parse(Buffer.from(r.result).toString() || 'null'));
const blob = (slot) => view('get_material', { case_id: caseId, slot });

const sk = fromHex(readFileSync('.keys/seal-buyer.key', 'utf8').trim());
const cctx = ctxOf(CONTRACT, caseId);
const K1 = open(sk, fromB64(await blob('env_r')), LABELS.wR, cctx);
const rec = decodeRecord(dec(K1, LABELS.resp0, fromB64(await blob('response')), cctx));
const respBytes = inflate(payloadSlice(rec.payload, rec.header.z));
const parsed = parseVerdictResponse(respBytes);
console.log(`case ${caseId} verdict: ${parsed?.verdict}`);
console.log(`reason: ${parsed?.reason}`);
