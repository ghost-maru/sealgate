// Sealgate reference state machine (SPEC §5).
//
// The kernel logic exists once: contract/src/kernel/*.js. Both hosts run
// that same code:
//   - contract/src/contract.ts  stores state in NEAR collections, reads the
//     caller / attached deposit / block time from the runtime, and turns a
//     withdraw into a transfer promise;
//   - this file stores state in Maps and takes caller / deposit / time as
//     arguments. Each call is atomic like a NEAR transaction: if it throws,
//     every write it made is rolled back.
// The unit tests and the exhaustive checker drive this machine, so they test
// the contract's own logic, not a copy of it.

import { createHash } from 'node:crypto';
import { dispatch, READERS, METHODS, closingTransition } from './src/kernel/profile.js';
import * as params from './src/kernel/params.js';
import * as fixing from './src/kernel/fixing.js';
import * as settlement from './src/kernel/settlement.js';
import * as registry from './src/kernel/registry.js';
import * as deadlines from './src/kernel/deadlines.js';

export { params, fixing, settlement, registry, deadlines, METHODS, closingTransition };
export const sha256 = (bytes) => new Uint8Array(createHash('sha256').update(bytes).digest());

// Values are stored as JSON strings (as the contract does), so no caller can
// alias live state and a rollback is a plain copy of the maps.
export class Machine {
  constructor({ owner, contractId = 'sealgate7.testnet' }) {
    this.contractId = contractId;
    this.state = { owner, nextCaseId: 0, signers: '[]', maps: { cases: new Map(), blobs: new Map(), clerks: new Map(), templates: new Map(), tplCount: new Map(), keys: new Map(), balances: new Map() } };
    this.logs = [];
    this.transfers = []; // withdrawals executed by the host
  }

  get store() {
    const st = this.state, m = st.maps, logs = this.logs;
    const getJ = (map, k) => (map.has(k) ? JSON.parse(map.get(k)) : null);
    const putJ = (map, k, v) => map.set(k, JSON.stringify(v));
    return {
      getOwner: () => st.owner,
      peekCaseId: () => st.nextCaseId,
      takeCaseId: () => st.nextCaseId++,
      getCase: (id) => getJ(m.cases, String(id)),
      putCase: (id, c) => putJ(m.cases, String(id), c),
      getBlob: (k) => (m.blobs.has(k) ? m.blobs.get(k) : null),
      putBlob: (k, v) => m.blobs.set(k, v),
      getClerk: (a) => getJ(m.clerks, a),
      putClerk: (a, r) => putJ(m.clerks, a, r),
      getTemplate: (k) => getJ(m.templates, k),
      putTemplate: (k, t) => putJ(m.templates, k, t),
      getTemplateCount: (clerk, id) => Number(m.tplCount.get(`${clerk}|${id}`) || 0),
      putTemplateCount: (clerk, id, n) => m.tplCount.set(`${clerk}|${id}`, String(n)),
      getKey: (a) => (m.keys.has(a) ? m.keys.get(a) : null),
      putKey: (a, k) => m.keys.set(a, k),
      getBalance: (a) => BigInt(m.balances.get(a) || '0'),
      putBalance: (a, v) => m.balances.set(a, v.toString()),
      getSigners: () => JSON.parse(st.signers),
      putSigners: (list) => { st.signers = JSON.stringify(list); },
      log: (msg) => logs.push(msg),
    };
  }

  snapshot() {
    const m = this.state.maps;
    const maps = {};
    for (const k of Object.keys(m)) maps[k] = new Map(m[k]);
    return { owner: this.state.owner, nextCaseId: this.state.nextCaseId, signers: this.state.signers, maps };
  }

  // call(method, { caller, deposit = 0n, now }, args)
  call(method, { caller, deposit = 0n, now }, args = {}) {
    const m = METHODS[method];
    if (!m || m.kind !== 'call') throw new Error(`E_NO_METHOD: ${method} is not a call method`);
    if (typeof deposit !== 'bigint') throw new Error('deposit must be a bigint');
    // near-sdk-js rejects any attached deposit on a non-payable method.
    if (!m.payable && deposit !== 0n) throw new Error('E_DEPOSIT: method is not payable');
    const before = this.snapshot();
    const nLogs = this.logs.length;
    try {
      const out = dispatch(this.store, { caller, deposit, now, sha256 }, method, args);
      if (out && out.transfer) this.transfers.push(out.transfer);
      return out;
    } catch (e) {
      this.state = before;
      this.logs.length = nLogs;
      throw e;
    }
  }

  view(method, args = {}) {
    if (method === 'quote_fee') return dispatch(this.store, { caller: null, deposit: 0n, now: 0, sha256 }, method, args);
    const r = READERS[method];
    if (!r) throw new Error(`E_NO_METHOD: ${method} is not a view`);
    return r(this.store, args);
  }

  // Test / checker conveniences.
  balance(account) { return this.store.getBalance(account); }
  getCase(id) { return this.store.getCase(id); }
  totalBalances() { let t = 0n; for (const v of this.state.maps.balances.values()) t += BigInt(v); return t; }
}
