// A party's local case material: raw bytes in files, one directory per
// (contract, case, account):
//
//   <casesDir>/<contract>/<caseId>/<account>/
//     criteria, criteria.salt        R: written by create; S: by preflight/submit (decrypted, hash-checked)
//     SK                             criteria key (secret, mode 600)
//     submission, submission.salt    S: written by preflight (prepared) and submit; R: by open (verified)
//     K, K2                          S: content key and release share (secret, mode 600)
//
// Nothing here is ever printed by the CLI except plaintexts the owner asked
// to see. Key material stays in these files; never on stdout, never in logs.

import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

export function caseStore(root, contract, caseId, account) {
  const dir = join(root, safe(contract), String(caseId), safe(account));
  const path = (n) => join(dir, n);
  return {
    dir,
    path,
    has: (n) => existsSync(path(n)),
    read: (n) => (existsSync(path(n)) ? new Uint8Array(readFileSync(path(n))) : null),
    write(n, bytes, { secret = false } = {}) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(path(n), bytes, { mode: secret ? 0o600 : 0o644 });
      if (secret) chmodSync(path(n), 0o600);
      return path(n);
    },
  };
}

export const storeFor = (ctx, caseId) => caseStore(ctx.casesDir, ctx.chain.contractId, caseId, ctx.account);
