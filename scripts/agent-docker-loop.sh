#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/infra/docker-compose.app.yml"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"

cleanup() {
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local tries=40
  for ((i=1; i<=tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✅ $name is up: $url"
      return 0
    fi
    sleep 2
  done
  echo "❌ Timed out waiting for $name: $url"
  return 1
}

trap cleanup EXIT

cd "$ROOT_DIR"

for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
  echo "\n=============================="
  echo "Attempt $attempt/$MAX_ATTEMPTS"
  echo "=============================="

  cleanup
  docker compose -f "$COMPOSE_FILE" up -d --build

  wait_for_http "http://127.0.0.1:4000/api/health" "API"
  wait_for_http "http://127.0.0.1:4100/health" "Worker"

  if node tests/integration.mjs; then
    echo "\n✅ All checks passed on attempt $attempt"
    echo "Stopping containers..."
    cleanup
    echo "✅ Containers stopped"
    exit 0
  fi

  echo "\n❌ Checks failed on attempt $attempt"
  echo "--- docker compose logs (tail) ---"
  docker compose -f "$COMPOSE_FILE" logs --tail=120 || true

  if (( attempt < MAX_ATTEMPTS )); then
    echo "Retrying..."
  fi

done

echo "\n❌ Workflow failed after $MAX_ATTEMPTS attempts."
echo "Please review logs above and patch code, then rerun scripts/agent-docker-loop.sh"
exit 1
