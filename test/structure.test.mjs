// Structural guarantees (SPEC §1 "the framework's guarantees are
// shown by structure", Appendix A): money and key material move only inside
// the settlement module; the contract exposes exactly the 13 protocol methods
// of §5.5 (plus read-only getters) wired to the same kernel the machine runs;
// the kernel uses nothing the NEAR JS runtime (QuickJS) lacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { METHODS } from '../contract/machine.mjs';
import { READERS } from '../contract/src/kernel/profile.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const KERNEL = here('../contract/src/kernel/');
const kernelFiles = readdirSync(KERNEL).filter((f) => f.endsWith('.js'));
const src = (f) => readFileSync(KERNEL + f, 'utf8');
const code = (f) => src(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // comments stripped

test('the kernel is split into the six framework components plus the profile', () => {
  for (const f of ['fixing.js', 'judgment.js', 'appeal.js', 'settlement.js', 'registry.js', 'deadlines.js', 'profile.js', 'params.js']) {
    assert.ok(kernelFiles.includes(f), f);
  }
});

test('only settlement.js writes balances or k2', () => {
  for (const f of kernelFiles) {
    const c = code(f);
    const writesBalance = /putBalance\s*\(/.test(c);
    const writesK2 = /\.k2\s*=(?!=)/.test(c);
    if (f === 'settlement.js') { assert.ok(writesBalance && writesK2, 'settlement moves money and keys'); continue; }
    assert.ok(!writesBalance, `${f} must not write balances`);
    assert.ok(!writesK2, `${f} must not write k2`);
  }
  // The profile only initializes k2 to null at creation, nothing else.
  assert.ok(/k2: null/.test(code('profile.js')));
});

test('the 13 protocol methods of §5.5', () => {
  assert.deepEqual(Object.keys(METHODS).sort(), [
    'appeal', 'create_case', 'finalize', 'post_appeal_decision', 'post_decision', 'quote_fee',
    'register_clerk', 'register_key', 'register_signer', 'register_template', 'respond', 'submit', 'withdraw',
  ]);
  assert.equal(Object.keys(METHODS).length, 13);
  assert.equal(METHODS.quote_fee.kind, 'view');
});

test('contract.ts declares each method with the decorator and payability the kernel table says, and routes it to the kernel', () => {
  const ts = readFileSync(here('../contract/src/contract.ts'), 'utf8');
  const decl = [...ts.matchAll(/@(call|view)\(\{([^}]*)\}\)\s*\n?\s*([a-z_0-9]+)\(/g)].map((x) => ({ kind: x[1], payable: /payableFunction:\s*true/.test(x[2]), name: x[3] }));
  const byName = Object.fromEntries(decl.map((d) => [d.name, d]));
  for (const [name, def] of Object.entries(METHODS)) {
    const d = byName[name];
    assert.ok(d, `contract.ts declares ${name}`);
    assert.equal(d.kind, def.kind, `${name} kind`);
    assert.equal(d.payable, def.payable, `${name} payable`);
    if (name !== 'quote_fee') assert.ok(ts.includes(`this.run('${name}', args)`), `${name} routes to the kernel`);
  }
  // Everything else the contract exposes is a read-only getter.
  for (const d of decl) {
    if (METHODS[d.name]) continue;
    assert.equal(d.kind, 'view', `${d.name} must be a view`);
    assert.ok(READERS[d.name], `${d.name} routes to a kernel reader`);
  }
});

test('the kernel avoids APIs the NEAR JS runtime does not provide', () => {
  for (const f of kernelFiles) {
    const c = code(f);
    for (const banned of ['TextEncoder', 'TextDecoder', 'Buffer', 'require(', 'process.', 'atob', 'btoa', 'crypto.', 'node:']) {
      assert.ok(!c.includes(banned), `${f} uses ${banned}`);
    }
    for (const m of c.matchAll(/from\s+'([^']+)'/g)) assert.ok(m[1].startsWith('./'), `${f} imports only kernel files (${m[1]})`);
  }
});
