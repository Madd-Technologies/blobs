#!/usr/bin/env bash
# Starts the local Hermes backend for HermesBot development: loopback-only, fixed session token.
#
# Safety: run exactly ONE Hermes backend. This script
# refuses to start if Hermes.app is open, anything listens on the port, or another `hermes serve` /
# `gateway` is running. HERMES_DESKTOP=1 makes serve run the cron ticker for every profile and kill
# orphaned Hermes processes, so two backends would fight over the same state.
#
# Usage: scripts/dev-server.sh [--check | --stop]
#   --check   run the preflight and exit without starting the server
#   --stop    stop the running dev server (and its fake model)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

if [ "${1:-}" = "--stop" ]; then
  "${HERMES_BIN:-$HOME/.hermes/hermes-agent/venv/bin/hermes}" serve --stop || true
  pkill -f "scripts/fake-llm.mjs" 2>/dev/null || true
  exit 0
fi

HERMES_BIN="${HERMES_BIN:-$HOME/.hermes/hermes-agent/venv/bin/hermes}"
PORT="${HERMES_DEV_PORT:-9119}"
FAKE_LLM_PORT="${FAKE_LLM_PORT:-9120}"
# Set HERMES_DEV_REAL_LLM=1 to skip the fake model and use whatever Hermes has configured.
USE_FAKE_LLM=1
[ "${HERMES_DEV_REAL_LLM:-0}" = "1" ] && USE_FAKE_LLM=0

fail() {
  echo "dev-server: $*" >&2
  exit 1
}

[ -x "$HERMES_BIN" ] || fail "hermes binary not found at $HERMES_BIN (set HERMES_BIN to override)"
[ -f .env.local ] || fail ".env.local is missing (needs HERMES_DASHBOARD_SESSION_TOKEN)"

# --- Preflight: one backend only ---------------------------------------------------------------
if pgrep -x "Hermes" >/dev/null 2>&1 || pgrep -f "Hermes.app/Contents" >/dev/null 2>&1; then
  fail "Hermes.app is running. Quit it first (Cmd+Q), then retry."
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "something is already listening on port $PORT:
$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN | tail -n +2)"
fi

if [ "$USE_FAKE_LLM" = 1 ] && lsof -nP -iTCP:"$FAKE_LLM_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  fail "something is already listening on the fake-model port $FAKE_LLM_PORT"
fi

# `hermes serve --status` lists every running Hermes web server (exits 0 either way).
if ! "$HERMES_BIN" serve --status 2>&1 | grep -qi "no hermes dashboard or serve processes"; then
  fail "a Hermes server is already running:
$("$HERMES_BIN" serve --status 2>&1)"
fi

# A gateway (messaging platforms: Telegram etc.) also counts as a second backend.
if pgrep -f "hermes.* gateway( |$)" >/dev/null 2>&1 || pgrep -f "hermes_cli.*gateway" >/dev/null 2>&1; then
  fail "a Hermes gateway process is running. Stop it first (hermes gateway stop)."
fi

if [ "$CHECK_ONLY" = 1 ]; then
  echo "dev-server: preflight ok (port $PORT free, no other Hermes backend running)"
  exit 0
fi

# --- Launch ------------------------------------------------------------------------------------
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

[ -n "${HERMES_DASHBOARD_SESSION_TOKEN:-}" ] || fail "HERMES_DASHBOARD_SESSION_TOKEN is empty in .env.local"

FAKE_PID=""
cleanup() {
  [ -n "$FAKE_PID" ] && kill "$FAKE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if [ "$USE_FAKE_LLM" = 1 ]; then
  # A dev machine's Hermes may have no usable LLM credentials, and tests shouldn't spend money, so the
  # dev server's `openrouter` provider is pointed at a local scripted model. The variables are set
  # for the hermes process only; no Hermes config or .env file is touched.
  node "$ROOT/scripts/fake-llm.mjs" &
  FAKE_PID=$!
  export OPENROUTER_BASE_URL="http://127.0.0.1:$FAKE_LLM_PORT/v1"
  export OPENROUTER_API_KEY="fake-local-dev-key"
  echo "dev-server: model traffic goes to the local fake model on :$FAKE_LLM_PORT (HERMES_DEV_REAL_LLM=1 to disable)"
fi

# Hermes switches to a coding-only toolset (no clarify) when its cwd looks like a code workspace, and
# this repo is one. Run it from a plain scratch directory instead.
WORKDIR="${HERMES_DEV_WORKDIR:-${TMPDIR:-/tmp}/hermesbot-dev-workspace}"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

echo "dev-server: starting hermes serve on 127.0.0.1:$PORT (loopback only, cwd $WORKDIR)"
# HERMES_DESKTOP=1                   -> serve runs the cron ticker (routines work in dev)
# HERMES_TUI_WS_ORPHAN_REAP_GRACE_S=0 -> a running turn survives the app's socket dropping
# (not exec'd, so the trap can stop the fake model when the server exits)
env HERMES_DESKTOP=1 HERMES_TUI_WS_ORPHAN_REAP_GRACE_S=0 \
  "$HERMES_BIN" serve --host 127.0.0.1 --port "$PORT"
