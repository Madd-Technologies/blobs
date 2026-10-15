#!/usr/bin/env bash
# The demo Hermes: a separate, fictional Hermes on this Mac for screenshots, videos and App Review.
# See docs/DEMO.md.
#
#   scripts/demo/demo.sh start      install if needed, create and seed the demo world if it is new, start it
#   scripts/demo/demo.sh stop       stop the demo's own processes (never any other Hermes)
#   scripts/demo/demo.sh reset      stop, wipe the demo world (not the install or the login), seed it again
#   scripts/demo/demo.sh status     what is running, and whether the seeded states are still live
#   scripts/demo/demo.sh password [--sim <udid>]
#                                   copy the sign-in password to the clipboard (or a simulator's), never print it
#
# Everything lives in $DEMO_ROOT (default ~/blobs-demo, outside the repo): the Hermes install, its own
# HERMES_HOME, logs, and the login file. The bots' fictional project lives in $DEMO_WORKSPACE (default
# /Users/Shared/blobs-demo) so no path a bot shows carries this Mac's user name.
# It never touches ~/.hermes, Hermes.app or ~/.local/bin/hermes, and never runs `hermes dashboard --stop`
# or `hermes serve --stop` (those stop every Hermes on the machine).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO_ROOT="${DEMO_ROOT:-$HOME/blobs-demo}"
DEMO_WORKSPACE="${DEMO_WORKSPACE:-/Users/Shared/blobs-demo}"
HERMES_TAG="v0.21.6"
HERMES_COMMIT="818c13be1dc4fd28987e1e881a9408224afd4535"
# The bot dashboards plugin, from the public plugins repo, pinned.
PLUGIN="Madd-Technologies/blobs-hermes-bot-plugins/hermes-dashboard"
PLUGIN_REF="c4a245ea7d72d587f2ba9b6e421901545f5e22ce"
INSTALL="$DEMO_ROOT/hermes-agent"
HERMES="$INSTALL/venv/bin/hermes"
PYTHON="$INSTALL/venv/bin/python"
HOME_DIR="$DEMO_ROOT/home"
RUN="$DEMO_ROOT/run"
LOGS="$DEMO_ROOT/logs"
LOGIN="$DEMO_ROOT/login"
PORT="${DEMO_PORT:-9219}"
MODEL_PORT="${DEMO_MODEL_PORT:-9220}"
URL="http://127.0.0.1:$PORT"
# A non-loopback public URL is what turns Hermes's sign-in gate on for a loopback bind. Nothing resolves
# or serves this name; the app connects to $URL.
PUBLIC_URL="http://blobs-demo.localhost:$PORT"
NODE_FLAGS=(--disable-warning=MODULE_TYPELESS_PACKAGE_JSON)

say() { printf 'demo: %s\n' "$*"; }
fail() {
  printf 'demo: %s\n' "$*" >&2
  exit 1
}

# The two folders a reset deletes: never an empty path, the root or a home folder.
safe_to_delete() {
  case "$1" in
    "" | / | "$HOME" | "$HOME/" | /Users | /Users/Shared) fail "refusing to delete '$1'" ;;
  esac
}

# Every Hermes command the demo runs gets the demo home and nothing from the caller's Hermes setup.
# (HERMES_DESKTOP would make the server reap "orphaned" Hermes processes machine-wide.)
# A turn outlives the socket that started it (the seeder's), and a foreground command may run for 12
# hours (Forge's long test run keeps it busy; the default cap of 600 s would background it).
HERMES_ENV=(env -u HERMES_DESKTOP -u HERMES_DASHBOARD_SESSION_TOKEN -u HERMES_DASHBOARD_PUBLIC_URL
  HERMES_HOME="$HOME_DIR" HERMES_TUI_WS_ORPHAN_REAP_GRACE_S=0 TERMINAL_MAX_FOREGROUND_TIMEOUT=43200)

# ── install ──────────────────────────────────────────────────────────────────────────────────────

install_hermes() {
  if [ -x "$HERMES" ] && [ "$(git -C "$INSTALL" rev-parse HEAD 2>/dev/null)" = "$HERMES_COMMIT" ]; then
    return
  fi

  local python=""
  for candidate in python3.14 /opt/homebrew/bin/python3.14; do
    if command -v "$candidate" >/dev/null 2>&1; then
      python="$(command -v "$candidate")"
      break
    fi
  done
  [ -n "$python" ] || fail "Hermes $HERMES_TAG needs Python 3.14 (brew install python@3.14)"

  mkdir -p "$DEMO_ROOT"
  if [ ! -d "$INSTALL/.git" ]; then
    say "cloning Hermes Agent $HERMES_TAG into $INSTALL"
    git clone --quiet --depth 1 --branch "$HERMES_TAG" https://github.com/NousResearch/hermes-agent.git "$INSTALL"
  fi
  [ "$(git -C "$INSTALL" rev-parse HEAD)" = "$HERMES_COMMIT" ] || fail "$INSTALL is not at $HERMES_TAG ($HERMES_COMMIT); delete it and rerun"

  say "creating its Python venv (a few minutes the first time)"
  "$python" -m venv "$INSTALL/venv"
  "$INSTALL/venv/bin/pip" install --quiet --upgrade pip
  "$INSTALL/venv/bin/pip" install --quiet -e "$INSTALL"
  # hermes-dashboard reads its own version with PyYAML, which 0.21.6 no longer ships.
  "$INSTALL/venv/bin/pip" install --quiet "PyYAML==6.0.3"
  say "installed $("$HERMES" --version 2>/dev/null | head -1)"
}

# ── login ────────────────────────────────────────────────────────────────────────────────────────

# The username and password the app signs in with. Made once, kept in $LOGIN (mode 600, outside the
# repo), never printed. The token secret lives there too, so sign-ins survive a reset.
ensure_login() {
  if [ -f "$LOGIN" ]; then
    return
  fi

  mkdir -p "$DEMO_ROOT"
  (
    umask 077
    {
      echo "# The demo Hermes sign-in (never commit, never paste anywhere public)."
      echo "DEMO_USERNAME=demo"
      echo "DEMO_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
      echo "DEMO_AUTH_SECRET=$(openssl rand -hex 32)"
    } >"$LOGIN"
  )
  say "made a sign-in for user \"demo\"; the password is in $LOGIN (npm run demo:password copies it)"
}

login_value() {
  sed -n "s/^$1=//p" "$LOGIN"
}

# ── the demo world ───────────────────────────────────────────────────────────────────────────────

write_workspace() {
  local project="$DEMO_WORKSPACE/storefront"
  safe_to_delete "$DEMO_WORKSPACE"
  rm -rf "$DEMO_WORKSPACE"
  mkdir -p "$DEMO_WORKSPACE"
  cp -R "$REPO/scripts/demo/storefront" "$project"

  # A repo whose main has two fixup commits already on its (local, bare) remote, then squashed
  # locally: the push Courier asks about is a real force push, and approving it is harmless.
  git init --quiet --bare "$DEMO_WORKSPACE/storefront.git"
  (
    cd "$project"
    export GIT_AUTHOR_NAME="Storefront Team" GIT_AUTHOR_EMAIL="team@storefront.example" \
      GIT_COMMITTER_NAME="Storefront Team" GIT_COMMITTER_EMAIL="team@storefront.example"
    git init --quiet --initial-branch=main
    git -c commit.gpgsign=false add -A
    git -c commit.gpgsign=false commit --quiet -m "Storefront 1.3.2"
    echo "export const savedCarts = true" >cart.mjs
    git add cart.mjs && git -c commit.gpgsign=false commit --quiet -m "Saved carts"
    echo "export const darkMode = 'system'" >theme.mjs
    git add theme.mjs && git -c commit.gpgsign=false commit --quiet -m "Dark mode"
    echo "export const savedCarts = { sync: true }" >cart.mjs
    git add cart.mjs && git -c commit.gpgsign=false commit --quiet -m "fixup! Saved carts"
    echo "export const darkMode = 'system' // follows the OS" >theme.mjs
    git add theme.mjs && git -c commit.gpgsign=false commit --quiet -m "fixup! Dark mode"
    git remote add origin "$DEMO_WORKSPACE/storefront.git"
    git push --quiet origin main
    GIT_SEQUENCE_EDITOR=true git -c commit.gpgsign=false rebase --quiet -i --autosquash HEAD~4
    git -c commit.gpgsign=false commit --quiet --allow-empty -m "Release 1.4.0"
  )
}

write_config() {
  mkdir -p "$HOME_DIR"
  local hash
  hash="$(DEMO_PASSWORD="$(login_value DEMO_PASSWORD)" "${HERMES_ENV[@]}" "$PYTHON" -I -c '
import os, sys
sys.path.insert(0, sys.argv[1])
from plugins.dashboard_auth.basic import hash_password
print(hash_password(os.environ["DEMO_PASSWORD"]))
' "$INSTALL")"

  (
    umask 077
    cat >"$HOME_DIR/config.yaml" <<EOF
# The demo Hermes (Blobs marketing and App Review). Written by scripts/demo/demo.sh; a reset rewrites it.
_config_version: 50
model:
  default: hermes-4-405b
  provider: custom
  base_url: http://127.0.0.1:$MODEL_PORT/v1
  api_key: demo-local
  context_length: 131072
agent:
  coding_context: "off"
  clarify_timeout: 0
  session_stall_timeout: 0
  gateway_timeout_warning: 0
approvals:
  mode: manual
  timeout: 2592000
timeouts:
  tools:
    concurrent_batch: 46800
    sequential_call: 46800
terminal:
  cwd: $DEMO_WORKSPACE/storefront
  timeout: 300
memory:
  memory_enabled: false
  user_profile_enabled: false
  nudge_interval: 0
auxiliary:
  title_generation:
    enabled: false
  background_review:
    enabled: false
curator:
  enabled: false
dashboard:
  public_url: $PUBLIC_URL
  basic_auth:
    username: $(login_value DEMO_USERNAME)
    password_hash: "$hash"
    secret: $(login_value DEMO_AUTH_SECRET)
    session_ttl_seconds: 2592000
EOF
  )
}

# ── processes ────────────────────────────────────────────────────────────────────────────────────

pid_alive() {
  local file="$RUN/$1.pid"
  [ -f "$file" ] && kill -0 "$(cat "$file")" 2>/dev/null
}

# Each process starts in its own session, so stopping it also stops whatever it started.
start_process() {
  local name="$1"
  shift
  mkdir -p "$RUN" "$LOGS"
  if pid_alive "$name"; then
    return
  fi
  nohup "$PYTHON" -I -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@" >>"$LOGS/$name.log" 2>&1 &
  echo $! >"$RUN/$name.pid"
  disown $!
}

stop_process() {
  local name="$1" file="$RUN/$1.pid"
  [ -f "$file" ] || return 0
  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 150); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL -- "-$pid" 2>/dev/null || true
    say "stopped $name"
  fi
  rm -f "$file"
}

port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | tail -n +2
}

wait_for_server() {
  for _ in $(seq 1 240); do
    if curl -fsS -o /dev/null "$URL/api/status" 2>/dev/null; then
      return 0
    fi
    pid_alive dashboard || fail "the dashboard exited; see $LOGS/dashboard.log"
    sleep 0.5
  done
  fail "the dashboard did not answer on $URL; see $LOGS/dashboard.log"
}

start_servers() {
  if ! pid_alive model; then
    [ -z "$(port_owner "$MODEL_PORT")" ] || fail "port $MODEL_PORT is taken:
$(port_owner "$MODEL_PORT")"
  fi
  if ! pid_alive dashboard; then
    [ -z "$(port_owner "$PORT")" ] || fail "port $PORT is taken:
$(port_owner "$PORT")"
  fi

  start_process model env DEMO_LLM_PORT="$MODEL_PORT" DEMO_WORKSPACE="$DEMO_WORKSPACE" DEMO_LLM_LOG="$LOGS/model-requests.jsonl" \
    node "$REPO/scripts/demo/demo-llm.mjs"
  # Hermes refuses to treat a code checkout as a plain chat workspace, so run it from the demo root.
  cd "$DEMO_ROOT"
  # The gateway runs routines (cron) and plugin hooks; the dashboard serves the app.
  start_process gateway "${HERMES_ENV[@]}" "$HERMES" gateway run --quiet
  start_process dashboard "${HERMES_ENV[@]}" "$HERMES" dashboard --host 127.0.0.1 --port "$PORT" --no-open --skip-build
  cd - >/dev/null
  wait_for_server
}

stop_all() {
  stop_process dashboard
  stop_process gateway
  stop_process model
  # A bot's long test run is started by Hermes in a session of its own.
  pkill -f "scripts/test.mjs --browsers" 2>/dev/null || true
}

# Installs the dashboard plugin into the demo home (no profile) or one of its bots. HERMES_HOME is what
# keeps it out of ~/.hermes.
install_plugin() {
  local scope=()
  [ -n "${1:-}" ] && scope=(-p "$1")
  "${HERMES_ENV[@]}" "$HERMES" ${scope[@]+"${scope[@]}"} plugins install "$PLUGIN" --ref "$PLUGIN_REF" --force --enable >>"$LOGS/setup.log" 2>&1 ||
    fail "installing hermes-dashboard${1:+ for $1} failed; see $LOGS/setup.log"
  say "installed hermes-dashboard${1:+ for $1}"
}

# The whole demo world, from an empty home: config, plugins, bots, then each bot's state. A plugin's
# routes and tools load when the servers start, so they restart once between the bots and their states.
build_world() {
  mkdir -p "$LOGS"
  write_workspace
  write_config
  install_plugin
  start_servers
  say "creating the five bots"
  seed_step bots
  # Hermes loads plugins per bot, so each bot with a dashboard gets its own copy.
  for bot in courier scout forge; do
    install_plugin "$bot"
  done
  stop_all >/dev/null
  start_servers
  say "filling the dashboards"
  for pair in courier:requests scout:scout forge:forge; do
    "${HERMES_ENV[@]}" "$PYTHON" -I "$REPO/scripts/demo/seed_dashboard.py" "$HOME_DIR/profiles/${pair%%:*}/plugins/hermes-dashboard" \
      "${pair%%:*}" "$REPO/scripts/demo/dashboard-${pair#*:}.json"
  done
  say "putting each bot in its state (about a minute)"
  seed_step world
}

seed_step() {
  DEMO_URL="$URL" DEMO_LOGIN="$LOGIN" node "${NODE_FLAGS[@]}" "$REPO/scripts/demo/seed.ts" "$1"
}

check_states() {
  seed_step status
}

# ── commands ─────────────────────────────────────────────────────────────────────────────────────

cmd_start() {
  install_hermes
  ensure_login
  if [ ! -f "$HOME_DIR/config.yaml" ]; then
    build_world
  else
    start_servers
    check_states || say "some seeded states are gone (a restart ends waiting turns): npm run demo:reset brings them back"
  fi
  say "up at $URL  (user \"$(login_value DEMO_USERNAME)\", password: npm run demo:password)"
}

cmd_reset() {
  stop_all
  install_hermes
  ensure_login
  safe_to_delete "$DEMO_ROOT"
  rm -rf "$HOME_DIR" "$LOGS"
  build_world
  say "reset and up at $URL"
}

cmd_status() {
  for name in model gateway dashboard; do
    if pid_alive "$name"; then say "$name running (pid $(cat "$RUN/$name.pid"))"; else say "$name stopped"; fi
  done
  if pid_alive dashboard; then
    check_states
  fi
}

cmd_password() {
  [ -f "$LOGIN" ] || fail "no login yet: run npm run demo:start"
  if [ "${1:-}" = "--sim" ]; then
    [ -n "${2:-}" ] || fail "usage: demo.sh password --sim <udid>"
    login_value DEMO_PASSWORD | tr -d '\n' | xcrun simctl pbcopy "$2"
    say "the password is on simulator $2's pasteboard"
  else
    login_value DEMO_PASSWORD | tr -d '\n' | pbcopy
    say "the password is on the clipboard"
  fi
}

case "${1:-}" in
  start) cmd_start ;;
  stop) stop_all ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  password) shift && cmd_password "$@" ;;
  *)
    echo "usage: scripts/demo/demo.sh start|stop|reset|status|password [--sim <udid>]" >&2
    exit 2
    ;;
esac
