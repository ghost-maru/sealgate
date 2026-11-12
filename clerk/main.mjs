#!/usr/bin/env node
// Sealgate reference clerk: entry point.
//
//   node clerk/main.mjs demo                    offline end-to-end dry run (no network)
//   node clerk/main.mjs show-registration       print registration values and template sizes (offline)
//   node clerk/main.mjs keygen-seal <path>      create the clerk's X25519 sealing key file (mode 600)
//   node clerk/main.mjs register [--dry-run] [--update-clerk] [--allow-new-version]
//   node clerk/main.mjs run [--once] [--force-k2]
//
// register and run reach the network and require SEALGATE_LIVE=1 plus the
// variables listed in clerk/config.mjs runtimeConfig. --force-k2 is the
// explicit override of the release safety margin (§7.6); never the default.

import { readFileSync, writeFileSync } from 'node:fs';
import { keypair, toHex, fromHex, utf8 } from '../shared/seal.mjs';
import { verifyTeeSignature } from '../shared/tee.mjs';
import { runtimeConfig, registrationFor, EFFECTIVE_NEAR_USD_CENTS, PRICE_BASIS } from './config.mjs';
import { TEMPLATES } from './templates.mjs';
import { clerkArgs, ensureRegistered, templateDeposit, bodyHashOf } from './register.mjs';
import { nearChain } from './chain.mjs';
import { nearAiCloud } from './ai.mjs';
import { createClerk } from './service.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f) => argv.includes(f);
const log = (s) => console.log(`${new Date().toISOString()} ${s}`);

function requireLive(cfg) {
  if (!cfg.live) {
    console.error('network access is off: set SEALGATE_LIVE=1 to talk to NEAR / NEAR AI Cloud');
    process.exit(2);
  }
}
function need(cfg, ...keys) {
  const missing = keys.filter((k) => !cfg[k]);
  if (missing.length) { console.error(`missing configuration: ${missing.join(', ')} (see clerk/config.mjs)`); process.exit(2); }
}
function readSealKey(path) {
  const hex = readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`${path} must hold 64 lowercase hex chars`);
  return keypair(fromHex(hex));
}

async function main() {
  const cfg = runtimeConfig();
  switch (cmd) {
    case 'demo': {
      const { runDemo } = await import('./demo.mjs');
      await runDemo({ log: console.log });
      return;
    }
    case 'show-registration': {
      console.log(JSON.stringify({
        priceBasis: { referenceNearUsdCents: PRICE_BASIS.referenceNearUsdCents.toString(), fxBufferPercent: PRICE_BASIS.fxBufferPercent.toString(), effectiveNearUsdCents: EFFECTIVE_NEAR_USD_CENTS.toString() },
        registration: registrationFor({ demo: cfg.demo }),
        templates: TEMPLATES.map((t) => ({ id: `${t.template_id}@${t.version}`, bytes: utf8(t.body).length, sha256: bodyHashOf(t.body), deposit: templateDeposit(t, { clerk: cfg.clerkAccount || '', version: t.version }).toString(), declarations: t.declarations })),
      }, null, 2));
      return;
    }
    case 'keygen-seal': {
      const path = argv[1];
      if (!path) { console.error('usage: keygen-seal <path>'); process.exit(2); }
      const kp = keypair();
      writeFileSync(path, `${toHex(kp.sk)}\n`, { mode: 0o600, flag: 'wx' }); // never overwrites
      console.log(`sealing key written to ${path}; public key (seal_key): ${toHex(kp.pk)}`);
      return;
    }
    case 'register': {
      const dryRun = flag('--dry-run');
      if (!cfg.live && !dryRun) requireLive(cfg);
      if (cfg.live) need(cfg, 'clerkAccount', 'clerkSealKeyFile');
      const sealKeyHex = cfg.clerkSealKeyFile ? toHex(readSealKey(cfg.clerkSealKeyFile).pk) : '<seal_key: public key from keygen-seal>';
      const args = clerkArgs({ account: cfg.clerkAccount || '<clerk account>', sealKeyHex, feeAccount: cfg.feeAccount, registration: registrationFor({ demo: cfg.demo }) });
      if (!cfg.live) {
        console.log('offline dry run: register_clerk args (called by the owner):');
        console.log(JSON.stringify(args, null, 2));
        for (const t of TEMPLATES) console.log(`register_template ${t.template_id} (expected @${t.version}), ${utf8(t.body).length} bytes, deposit ${templateDeposit(t, { clerk: args.account, version: t.version })} yocto`);
        return;
      }
      need(cfg, 'contract', 'clerkKeyFile', ...(dryRun ? [] : ['ownerAccount', 'ownerKeyFile']));
      const clerkChain = nearChain({ contractId: cfg.contract, rpcUrl: cfg.rpcUrl, accountId: cfg.clerkAccount, keyFile: cfg.clerkKeyFile });
      const ownerChain = dryRun ? clerkChain : nearChain({ contractId: cfg.contract, rpcUrl: cfg.rpcUrl, accountId: cfg.ownerAccount, keyFile: cfg.ownerKeyFile });
      const report = await ensureRegistered({ ownerChain, clerkChain, args, dryRun, updateClerk: flag('--update-clerk'), allowNewVersion: flag('--allow-new-version'), log });
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    case 'run': {
      requireLive(cfg);
      need(cfg, 'contract', 'clerkAccount', 'clerkKeyFile', 'clerkSealKeyFile', 'nearAiApiKey');
      const kp = readSealKey(cfg.clerkSealKeyFile);
      const chain = nearChain({ contractId: cfg.contract, rpcUrl: cfg.rpcUrl, accountId: cfg.clerkAccount, keyFile: cfg.clerkKeyFile });
      const reg = await chain.view('get_clerk', { account: cfg.clerkAccount });
      if (!reg) { console.error(`${cfg.clerkAccount} is not a registered clerk on ${cfg.contract}`); process.exit(2); }
      if (reg.sealKey !== toHex(kp.pk)) { console.error('the sealing key file does not match the registered seal_key'); process.exit(2); }
      const ai = nearAiCloud({ apiKey: cfg.nearAiApiKey });
      const clerk = createClerk({ chain, ai, clerkSk: kp.sk, verifySignature: verifyTeeSignature, options: { pollMs: cfg.pollMs, startCaseId: cfg.startCaseId, forceK2: flag('--force-k2') }, log });
      log(`clerk ${cfg.clerkAccount} on ${cfg.contract}${flag('--force-k2') ? ' (FORCE-K2: release margin overridden)' : ''}`);
      await clerk.run({ once: flag('--once') });
      return;
    }
    default:
      console.log('usage: node clerk/main.mjs <demo | show-registration | keygen-seal <path> | register [--dry-run] [--update-clerk] [--allow-new-version] | run [--once] [--force-k2]>');
      process.exit(cmd ? 2 : 0);
  }
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
