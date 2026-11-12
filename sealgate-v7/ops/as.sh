#!/bin/bash
# usage: ops/as.sh buyer|worker <cli args...>
party=$1; shift
cd ~/workspace/near-hackathon/sealgate-v7
if [ "$party" = buyer ]; then
  export SEALGATE_ACCOUNT_KEY_FILE=../sealgate/.keys/buyer.json SEALGATE_SEAL_KEY_FILE=.keys/seal-buyer.key
  acct=sgbuyer-ghost.testnet
else
  export SEALGATE_ACCOUNT_KEY_FILE=../sealgate/.keys/worker.json SEALGATE_SEAL_KEY_FILE=.keys/seal-worker.key
  acct=sgworker-ghost.testnet
fi
SEALGATE_LIVE=1 SEALGATE7_CONTRACT=sealgate7-ghost.testnet SEALGATE_CASES_DIR=.keys/cases \
  node cli/main.mjs --account $acct "$@"
