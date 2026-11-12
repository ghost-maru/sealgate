// Chain access for the clerk, behind one small interface:
//
//   chain.contractId                  the v7 contract account
//   chain.accountId                   the account this handle signs as
//   chain.view(method, args)          read at finality "final" -> parsed JSON
//   chain.call(method, args, deposit) signed function call (deposit: bigint yocto)
//   chain.finalBlockTimeMs()          timestamp of the latest finalized block (ms)
//
// MachineChain runs against the in-memory reference machine (contract/machine.mjs,
// the same kernel code as the contract) with an injected clock: used by the
// tests and the offline demo. nearChain talks to a NEAR RPC node; it is only
// constructed by the entry point when SEALGATE_LIVE=1.

import { readFileSync } from 'node:fs';
import { CALL_GAS } from './config.mjs';

export class MachineChain {
  constructor(machine, { accountId, clock }) {
    this.machine = machine;
    this.accountId = accountId;
    this.clock = clock;
  }
  get contractId() { return this.machine.contractId; }
  as(accountId) { return new MachineChain(this.machine, { accountId, clock: this.clock }); }
  async view(method, args = {}) {
    const out = this.machine.view(method, args);
    return out === undefined ? null : JSON.parse(JSON.stringify(out));
  }
  async call(method, args = {}, deposit = 0n) {
    return this.machine.call(method, { caller: this.accountId, deposit: BigInt(deposit), now: this.clock() }, args);
  }
  async finalBlockTimeMs() { return this.clock(); }
}

// Live NEAR access. Views and block time use plain JSON-RPC at finality
// "final"; calls use near-api-js (loaded lazily) with the account key read
// from keyFile at the first call. The key never leaves this process.
export function nearChain({ contractId, rpcUrl, accountId, keyFile, fetchImpl = globalThis.fetch }) {
  if (!contractId) throw new Error('SEALGATE7_CONTRACT is not set');
  let id = 0;
  async function rpc(method, params) {
    const r = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: `sg7-${++id}`, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`RPC ${method}: ${JSON.stringify(j.error).slice(0, 300)}`);
    if (j.result && j.result.error) throw new Error(`RPC ${method}: ${String(j.result.error).slice(0, 300)}`);
    return j.result;
  }
  let account = null;
  async function getAccount() {
    if (account) return account;
    if (!accountId || !keyFile) throw new Error('a signing account and its key file are required for calls');
    const { Account, JsonRpcProvider, KeyPairSigner } = await import('near-api-js');
    const key = JSON.parse(readFileSync(keyFile, 'utf8'));
    const secret = key.secret_key || key.private_key || key.secretKey;
    if (!secret) throw new Error(`no secret_key / private_key in ${keyFile}`);
    account = new Account(accountId, new JsonRpcProvider({ url: rpcUrl }), await KeyPairSigner.fromSecretKey(secret));
    return account;
  }
  return {
    contractId,
    accountId,
    async view(method, args = {}) {
      let last;
      for (let i = 0; i < 4; i++) {
        try {
          const res = await rpc('query', {
            request_type: 'call_function', finality: 'final', account_id: contractId,
            method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
          });
          return JSON.parse(Buffer.from(res.result).toString('utf8'));
        } catch (e) {
          last = e;
          await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
        }
      }
      throw last;
    },
    async call(method, args = {}, deposit = 0n) {
      const acc = await getAccount();
      return acc.callFunction({ contractId, methodName: method, args, gas: CALL_GAS, deposit: BigInt(deposit) });
    },
    async finalBlockTimeMs() {
      const b = await rpc('block', { finality: 'final' });
      return Number(BigInt(b.header.timestamp_nanosec) / 1_000_000n);
    },
  };
}
