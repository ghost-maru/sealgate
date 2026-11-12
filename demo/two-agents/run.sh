#!/usr/bin/env bash
# R5: two independent agents trade through Sealgate (see README.md in this dir).
# Buyer and worker run as separate CLI processes with separate key custody
# (SEALGATE_KEYS_DIR) and separate record views (SEALGATE_RECORDS_DIR). The
# criteria and the deliverable cross between them only as X25519-sealed
# bundles; the receiver checks the salted hash against the on-chain
# commitment before accepting anything.
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a && . ../spike/.nearai.env && set +a

CLI="node cli/sealgate.mjs"
B_KEYS="$PWD/demo/two-agents/buyer/.keys";  B_REC="$PWD/demo/two-agents/buyer/records"
W_KEYS="$PWD/demo/two-agents/worker/.keys"; W_REC="$PWD/demo/two-agents/worker/records"

echo "== [buyer process] creates the escrow (Nightjar criteria, salted) =="
OUT=$(SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer $CLI create demo/criteria-nightjar.txt 1)
echo "$OUT"; ID=$(echo "$OUT" | grep -oP 'escrow created: \K[0-9]+')
echo "escrow id: $ID"

echo "== each process registers only its own X25519 key =="
SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer  $CLI register-keys "$ID" buyer
SEALGATE_KEYS_DIR="$W_KEYS" SEALGATE_RECORDS_DIR="$W_REC" SEALGATE_PARTY=worker $CLI register-keys "$ID" worker

echo "== [buyer -> worker] engagement bundle: criteria + salt, sealed to the worker's key =="
SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer  $CLI seal-for "$ID" engagement
SEALGATE_KEYS_DIR="$W_KEYS" SEALGATE_RECORDS_DIR="$W_REC" SEALGATE_PARTY=worker $CLI open-bundle "$ID" "bundles/$ID-engagement.json"

echo "== [worker process] delivers the work (hash committed on-chain) =="
SEALGATE_KEYS_DIR="$W_KEYS" SEALGATE_RECORDS_DIR="$W_REC" SEALGATE_PARTY=worker $CLI deliver "$ID" demo/deliverable-nightjar.txt

echo "== [worker -> buyer] deliverable bundle, sealed to the buyer's key =="
SEALGATE_KEYS_DIR="$W_KEYS" SEALGATE_RECORDS_DIR="$W_REC" SEALGATE_PARTY=worker $CLI seal-for "$ID" deliverable
SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer  $CLI open-bundle "$ID" "bundles/$ID-deliverable.json"

echo "== [worker process] runs the TEE inspection and posts the L0 claim =="
SEALGATE_KEYS_DIR="$W_KEYS" SEALGATE_RECORDS_DIR="$W_REC" SEALGATE_PARTY=worker $CLI inspect "$ID"

echo "== [buyer process] verifies the claim against its own record, then co-signs =="
SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer $CLI verify "$ID"
SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer $CLI co-sign "$ID" buyer

echo "== settled: the worker posted the claim, so its co-signature is already on it;"
echo "   the buyer's co-sign completes the pair (fast finality) =="
SEALGATE_KEYS_DIR="$B_KEYS" SEALGATE_RECORDS_DIR="$B_REC" SEALGATE_PARTY=buyer  $CLI show "$ID"
echo "R5 demo complete: escrow $ID settled between two independent processes."
