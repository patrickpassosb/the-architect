#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

FORCE_KILL_PORTS=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE_KILL_PORTS=1
fi

API_PID=""
WORKER_PID=""
WEB_PID=""

cleanup() {
  set +e
  if [[ -n "$API_PID" ]]; then kill "$API_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$WORKER_PID" ]]; then kill "$WORKER_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$WEB_PID" ]]; then kill "$WEB_PID" >/dev/null 2>&1 || true; fi
}

trap cleanup EXIT INT TERM

check_port() {
  local port="$1"
  local pids
  pids="$(fuser -n tcp "$port" 2>/dev/null || true)"

  if [[ -z "$pids" ]]; then
    return 0
  fi

  if [[ "$FORCE_KILL_PORTS" -eq 1 ]]; then
    echo "Port :$port busy (PID(s): $pids). Stopping..."
    # shellcheck disable=SC2086
    kill $pids >/dev/null 2>&1 || true
    sleep 1
    return 0
  fi

  echo "Error: port :$port is already in use (PID(s): $pids)."
  echo "Stop those processes and retry, or run:"
  echo "  bash scripts/dev-all.sh --force"
  exit 1
}

check_port 3000
check_port 4000
check_port 4100

db_url="$(grep -E '^DATABASE_URL=' "$ROOT_DIR/.env" 2>/dev/null | head -n 1 | cut -d '=' -f2- || true)"
if [[ -z "$db_url" ]]; then
  db_url="./data/the-architect.sqlite"
fi

if [[ "$db_url" != ":memory:" ]]; then
  if [[ "$db_url" == sqlite://* ]]; then
    db_url="${db_url#sqlite://}"
  elif [[ "$db_url" == file:* ]]; then
    db_url="${db_url#file:}"
  fi

  if [[ "$db_url" != /* ]]; then
    db_path="$ROOT_DIR/$db_url"
  else
    db_path="$db_url"
  fi

  if [[ -f "$db_path" && ! -w "$db_path" ]]; then
    if [[ "$FORCE_KILL_PORTS" -eq 1 ]]; then
      echo "Database not writable at '$db_path'. Resetting local sqlite files..."
      rm -f "$db_path" "$db_path-shm" "$db_path-wal"
    else
      echo "Error: database is not writable: $db_path"
      echo "Run with --force to reset local sqlite files, or fix file ownership/permissions."
      exit 1
    fi
  fi
fi

echo "Starting Redis..."
npm run redis:up

echo "Starting API on :4000..."
npm run dev:api &
API_PID=$!

echo "Starting worker on :4100..."
npm run dev:worker &
WORKER_PID=$!

echo "Starting web on :3000..."
npm run dev -w apps/web &
WEB_PID=$!

echo "All services launched. Press Ctrl+C to stop."

wait -n "$API_PID" "$WORKER_PID" "$WEB_PID"
