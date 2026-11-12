// Sealgate contract (SPEC): the NEAR host of the judgment kernel.
//
// All protocol logic lives in ./kernel/*.js: the six framework components
// (fixing, judgment, appeal, settlement, registry, deadlines) and the
// profile that wires them (profile.js). The same files run in the
// reference machine (../machine.mjs) the unit tests drive. This wrapper only
//   - persists state in NEAR collections (values are JSON strings),
//   - supplies the caller, the attached deposit, the block time (ms) and sha256,
//   - executes a withdraw as a transfer promise (the single outbound transfer).
// A thrown error panics the call, so every write it made is reverted.
import { NearBindgen, near, call, view, initialize, LookupMap } from 'near-sdk-js';
import { dispatch, READERS } from './kernel/profile.js';

const nowMs = (): number => Number(near.blockTimestamp() / 1_000_000n);
const sha256 = (b: Uint8Array): Uint8Array => near.sha256(b);

@NearBindgen({ requireInit: true })
class Sealgate7 {
  owner: string = '';
  nextCaseId: number = 0;
  signers: string = '[]';
  cases: LookupMap<string> = new LookupMap<string>('c');
  blobs: LookupMap<string> = new LookupMap<string>('m');
  clerks: LookupMap<string> = new LookupMap<string>('k');
  templates: LookupMap<string> = new LookupMap<string>('t');
  tplCount: LookupMap<string> = new LookupMap<string>('n');
  keys: LookupMap<string> = new LookupMap<string>('s');
  balances: LookupMap<string> = new LookupMap<string>('b');

  // The store interface the kernel expects (same as machine.mjs).
  store(): any {
    const self = this;
    const getJ = (map: LookupMap<string>, k: string): any => { const v = map.get(k); return v === null || v === undefined ? null : JSON.parse(v); };
    const putJ = (map: LookupMap<string>, k: string, v: any) => map.set(k, JSON.stringify(v));
    return {
      getOwner: () => self.owner,
      peekCaseId: () => self.nextCaseId,
      takeCaseId: () => self.nextCaseId++,
      getCase: (id: number) => getJ(self.cases, String(id)),
      putCase: (id: number, c: any) => putJ(self.cases, String(id), c),
      getBlob: (k: string) => { const v = self.blobs.get(k); return v === undefined ? null : v; },
      putBlob: (k: string, v: string) => self.blobs.set(k, v),
      getClerk: (a: string) => getJ(self.clerks, a),
      putClerk: (a: string, r: any) => putJ(self.clerks, a, r),
      getTemplate: (k: string) => getJ(self.templates, k),
      putTemplate: (k: string, t: any) => putJ(self.templates, k, t),
      getTemplateCount: (clerk: string, id: string) => Number(self.tplCount.get(`${clerk}|${id}`) || 0),
      putTemplateCount: (clerk: string, id: string, n: number) => self.tplCount.set(`${clerk}|${id}`, String(n)),
      getKey: (a: string) => { const v = self.keys.get(a); return v === undefined ? null : v; },
      putKey: (a: string, k: string) => self.keys.set(a, k),
      getBalance: (a: string) => BigInt(self.balances.get(a) || '0'),
      putBalance: (a: string, v: bigint) => self.balances.set(a, v.toString()),
      getSigners: () => JSON.parse(self.signers),
      putSigners: (list: string[]) => { self.signers = JSON.stringify(list); },
      log: (msg: string) => near.log(msg),
    };
  }

  run(method: string, args: any): any {
    const ctx = { caller: near.predecessorAccountId(), deposit: near.attachedDeposit(), now: nowMs(), sha256 };
    return dispatch(this.store(), ctx, method, args || {});
  }

  read(name: string, args: any): any {
    return (READERS as any)[name](this.store(), args || {});
  }

  @initialize({})
  init({ owner }: { owner: string }) { this.owner = owner; }

  // ---- registry ⑤ ----
  @call({})
  register_key(args: any) { this.run('register_key', args); }

  @call({})
  register_clerk(args: any) { this.run('register_clerk', args); }

  @call({})
  register_signer(args: any) { return this.run('register_signer', args); }

  @call({ payableFunction: true })
  register_template(args: any) { return this.run('register_template', args); }

  // ---- lifecycle (profile) ----
  @call({ payableFunction: true })
  create_case(args: any) { return this.run('create_case', args); }

  @call({ payableFunction: true })
  submit(args: any) { this.run('submit', args); }

  @call({ payableFunction: true })
  post_decision(args: any) { this.run('post_decision', args); }

  @call({ payableFunction: true })
  appeal(args: any) { this.run('appeal', args); }

  @call({ payableFunction: true })
  respond(args: any) { this.run('respond', args); }

  @call({ payableFunction: true })
  post_appeal_decision(args: any) { this.run('post_appeal_decision', args); }

  @call({})
  finalize(args: any) { return this.run('finalize', args); }

  // ---- settlement ④: the only outbound transfer ----
  @call({})
  withdraw(args: any) {
    const out = this.run('withdraw', args);
    const p = near.promiseBatchCreate(out.transfer.to);
    near.promiseBatchActionTransfer(p, out.transfer.amount);
  }

  @view({})
  quote_fee(args: any): string {
    return dispatch(this.store(), { caller: '', deposit: 0n, now: 0, sha256 }, 'quote_fee', args || {});
  }

  // ---- read-only getters (not protocol methods) ----
  @view({}) get_case(args: any) { return this.read('get_case', args); }
  @view({}) get_material(args: any) { return this.read('get_material', args); }
  @view({}) next_case_id() { return this.read('next_case_id', {}); }
  @view({}) get_clerk(args: any) { return this.read('get_clerk', args); }
  @view({}) get_template(args: any) { return this.read('get_template', args); }
  @view({}) get_template_count(args: any) { return this.read('get_template_count', args); }
  @view({}) get_key(args: any) { return this.read('get_key', args); }
  @view({}) get_signers() { return this.read('get_signers', {}); }
  @view({}) get_balance(args: any) { return this.read('get_balance', args); }
  @view({}) get_owner() { return this.read('get_owner', {}); }
}
