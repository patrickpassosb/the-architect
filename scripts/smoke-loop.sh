#!/usr/bin/env bash
set -euo pipefail

LOOPS="${LOOPS:-3}"
REQUIRE_PROVIDER_SUCCESS="${REQUIRE_PROVIDER_SUCCESS:-1}"

if ! [[ "$LOOPS" =~ ^[0-9]+$ ]] || [ "$LOOPS" -lt 1 ]; then
  echo "LOOPS must be a positive integer"
  exit 1
fi

echo "Running integration smoke loop"
echo "LOOPS=$LOOPS"
echo "REQUIRE_PROVIDER_SUCCESS=$REQUIRE_PROVIDER_SUCCESS"

for ((i=1; i<=LOOPS; i++)); do
  echo
  echo "== Smoke run $i/$LOOPS =="
  REQUIRE_PROVIDER_SUCCESS="$REQUIRE_PROVIDER_SUCCESS" node tests/integration.mjs
done

echo
echo "All smoke runs passed."
