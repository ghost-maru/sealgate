// An offline sandbox: the in-memory reference machine (the contract's own
// kernel code), real §7 cryptography, a controllable clock, and party
// helpers. Used by the offline demo (clerk/main.mjs demo) and the tests. No
// network, no secrets: every key here is generated in memory.

import { Machine } from '../contract/machine.mjs';
import { RECORD_FEE, STORAGE_PRICE_PER_BYTE } from '../contract/src/kernel/params.js';
import { keypair, toHex, fromB64, buildCriteria, buildSubmission } from '../shared/seal.mjs';
import { MachineChain } from './chain.mjs';
import { REGISTRATION } from './config.mjs';
import { clerkArgs, ensureRegistered } from './register.mjs';
import { MOCK_SIGNER } from './mock-ai.mjs';

export const NEAR = 10n ** 24n;
export const CONTRACT = 'sealgate7.testnet';
export const OWNER = 'owner.testnet';
export const CLERK = 'clerk.testnet';
export const FEES = 'fees.testnet';
export const R = 'alice.testnet';
export const S = 'bob.testnet';
export const T0 = 1_700_000_000_000;
export const HOUR = 3_600_000;

const storage = (bytes) => BigInt(bytes) * STORAGE_PRICE_PER_BYTE;

export function createSandbox({ registration = REGISTRATION } = {}) {
  const state = { now: T0 };
  const clock = () => state.now;
  const m = new Machine({ owner: OWNER, contractId: CONTRACT });
  const keys = { clerk: keypair(), R: keypair(), S: keypair() };
  const owner = new MachineChain(m, { accountId: OWNER, clock });
  const clerk = new MachineChain(m, { accountId: CLERK, clock });
  const cases = {};

  m.call('register_key', { caller: R, now: state.now }, { pubkey: toHex(keys.R.pk) });
  m.call('register_key', { caller: S, now: state.now }, { pubkey: toHex(keys.S.pk) });
  m.call('register_signer', { caller: OWNER, now: state.now }, { algo: MOCK_SIGNER.algo, address: MOCK_SIGNER.address });

  const sb = {
    m, state, clock, keys, owner, clerk, cases,
    args: clerkArgs({ account: CLERK, sealKeyHex: toHex(keys.clerk.pk), feeAccount: FEES, registration }),
    advance(ms) { state.now += ms; return state.now; },
    at(t) { state.now = t; return t; },
    register(opts = {}) { return ensureRegistered({ ownerChain: owner, clerkChain: clerk, args: sb.args, ...opts }); },
    getCase: (id) => m.getCase(id),

    // R creates a case with real criteria material.
    createCase({ templateId = 'inspection', version = 1, amount = 5n * NEAR, criteria, wSec = 3600, submitWindowSec = 86400 } = {}) {
      const caseId = m.view('next_case_id');
      const mat = buildCriteria({ contract: CONTRACT, caseId, criteria, submitterPk: keys.S.pk });
      const ctLen = fromB64(mat.criteria_ct).length;
      const args = {
        clerk: CLERK, template_id: templateId, template_version: version, submitter: S, amount: amount.toString(),
        criteria_hash: mat.criteria_hash, criteria_ct: mat.criteria_ct, env_s: mat.env_s,
        submit_window_sec: submitWindowSec, w_sec: wSec, expected_case_id: caseId,
      };
      m.call('create_case', { caller: R, now: state.now, deposit: amount + RECORD_FEE + storage(32 + ctLen + 80) }, args);
      cases[caseId] = { SK: mat.SK, criteria, critSalt: mat.salt };
      return caseId;
    },

    // S submits real material (overrides let a test corrupt it).
    submit(caseId, submission, override = {}) {
      const sub = buildSubmission({ contract: CONTRACT, caseId, submission, SK: cases[caseId].SK, clerkPk: keys.clerk.pk, requesterPk: keys.R.pk });
      const args = { case_id: caseId, sub_hash: sub.sub_hash, sub_ct: sub.sub_ct, env_c: sub.env_c, env_r: sub.env_r, lock: sub.lock, ...override };
      const subLen = fromB64(args.sub_ct).length;
      const cap1 = BigInt(m.view('quote_fee', { case_id: caseId, kind: 'primary', sub_len: subLen }));
      m.call('submit', { caller: S, now: state.now, deposit: cap1 + storage(32 + subLen + 144 + 80 + 32) }, args);
      Object.assign(cases[caseId], { sub, submission, cap1 });
      return sub;
    },

    // The side the primary judgment went against appeals; the other responds.
    appeal(caseId) {
      const c = m.getCase(caseId);
      const by = c.decision.verdict === 'PASS' ? R : S;
      const capA = BigInt(m.view('quote_fee', { case_id: caseId, kind: 'appeal', sub_len: c.submission.ctLen }));
      m.call('appeal', { caller: by, now: state.now, deposit: BigInt(c.bond) + capA }, { case_id: caseId });
      return { by, capA };
    },
    respond(caseId) {
      const c = m.getCase(caseId);
      m.call('respond', { caller: c.appeal.respondent, now: state.now, deposit: BigInt(c.bond) }, { case_id: caseId });
      return c.appeal.respondent;
    },
  };
  return sb;
}
