#!/usr/bin/env bash
# scripts/healthcheck.sh
#
# Quick health check for the Hermes + task-worker + OpenClaw stack.
# Exits 0 if everything looks healthy, non-zero on the first failure.
#
# Usage:
#   ./scripts/healthcheck.sh            # human-readable
#   ./scripts/healthcheck.sh --quiet    # only print failures and final status
#   ./scripts/healthcheck.sh --json     # machine-readable summary
#
# Env overrides (all optional):
#   HERMES_HOST=127.0.0.1
#   HERMES_PORT=8644
#   TASK_WORKER_HOST=127.0.0.1
#   TASK_WORKER_PORT=9000
#   OPENCLAW_HOST=127.0.0.1
#   OPENCLAW_PORT=18789
#   HERMES_INBOUND_SCRIPT=./scripts/hermes-inbound-test.sh

set -u
set -o pipefail

# ---- Config ----------------------------------------------------------------

HERMES_HOST="${HERMES_HOST:-127.0.0.1}"
HERMES_PORT="${HERMES_PORT:-8644}"

TASK_WORKER_HOST="${TASK_WORKER_HOST:-127.0.0.1}"
TASK_WORKER_PORT="${TASK_WORKER_PORT:-9000}"

OPENCLAW_HOST="${OPENCLAW_HOST:-127.0.0.1}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"

# ---- Resolve hermes-inbound-test.sh location ------------------------------
#
# Priority:
#   1. $HERMES_INBOUND_SCRIPT (explicit override)
#   2. ./scripts/hermes-inbound-test.sh (repo-local)
#   3. ~/.hermes/scripts/hermes-inbound-test.sh
#   4. ~/Development/task-worker-rag/scripts/hermes-inbound-test.sh
#
# First match that exists AND is executable wins. If none match, we keep
# whatever path was first tried so the failure message points at a sensible
# default.

_hermes_candidates=(
  "${HERMES_INBOUND_SCRIPT:-}"
  "./scripts/hermes-inbound-test.sh"
  "${HOME}/.hermes/scripts/hermes-inbound-test.sh"
  "${HOME}/Development/task-worker-rag/scripts/hermes-inbound-test.sh"
)

HERMES_INBOUND_SCRIPT=""
for _p in "${_hermes_candidates[@]}"; do
  [[ -z "$_p" ]] && continue
  if [[ -x "$_p" ]]; then
    HERMES_INBOUND_SCRIPT="$_p"
    break
  fi
done

# Fallback to the first non-empty candidate so error messages are useful.
if [[ -z "$HERMES_INBOUND_SCRIPT" ]]; then
  for _p in "${_hermes_candidates[@]}"; do
    if [[ -n "$_p" ]]; then
      HERMES_INBOUND_SCRIPT="$_p"
      break
    fi
  done
fi
unset _hermes_candidates _p

QUIET=0
JSON=0
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=1 ;;
    --json)  JSON=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

# ---- Output helpers --------------------------------------------------------

RESULTS=()
FAIL_COUNT=0

c_reset=$'\033[0m'
c_red=$'\033[31m'
c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_bold=$'\033[1m'

if [[ ! -t 1 ]]; then
  c_reset=""; c_red=""; c_green=""; c_yellow=""; c_bold=""
fi

log() {
  [[ $QUIET -eq 1 ]] && return 0
  echo "$@"
}

record() {
  # record <name> <ok|fail> <detail>
  local name="$1" status="$2" detail="$3"
  RESULTS+=("${name}|${status}|${detail}")
  if [[ "$status" == "fail" ]]; then
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "${c_red}${c_bold}FAIL${c_reset} ${name}: ${detail}" >&2
  else
    log "${c_green}OK  ${c_reset} ${name}: ${detail}"
  fi
}

# ---- Checks ----------------------------------------------------------------

check_listener() {
  local label="$1" host="$2" port="$3"
  # Try ss first (Linux), fall back to /dev/tcp
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR>1{exit 0} END{if(NR<=1) exit 1}'; then
      record "listener:${label}" ok "${host}:${port} is listening"
      return 0
    fi
  fi
  if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
    record "listener:${label}" ok "${host}:${port} accepts TCP"
    return 0
  fi
  record "listener:${label}" fail "nothing listening on ${host}:${port}"
  return 1
}

check_task_worker_root() {
  local url="http://${TASK_WORKER_HOST}:${TASK_WORKER_PORT}/"
  local body
  body=$(curl -fsS --max-time 5 "$url" 2>/dev/null) || {
    record "task-worker:/" fail "GET ${url} failed"
    return 1
  }
  if [[ "$body" == *"Server is running"* ]]; then
    record "task-worker:/" ok "GET ${url} -> 'Server is running'"
    return 0
  fi
  record "task-worker:/" fail "GET ${url} returned unexpected body: ${body:0:80}"
  return 1
}

check_openclaw_root() {
  local url="http://${OPENCLAW_HOST}:${OPENCLAW_PORT}/"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url") || {
    record "openclaw:/" fail "curl to ${url} failed"
    return 1
  }
  if [[ "$code" =~ ^2|3 ]]; then
    record "openclaw:/" ok "GET ${url} -> ${code}"
    return 0
  fi
  if [[ "$code" == "401" || "$code" == "403" ]]; then
    # Some OpenClaw builds gate '/'; still proves the server is alive.
    record "openclaw:/" ok "GET ${url} -> ${code} (auth-gated, server alive)"
    return 0
  fi
  record "openclaw:/" fail "GET ${url} -> ${code}"
  return 1
}

check_hermes_inbound() {
  if [[ ! -x "$HERMES_INBOUND_SCRIPT" ]]; then
    record "hermes:inbound" fail "missing or non-executable: ${HERMES_INBOUND_SCRIPT}"
    return 1
  fi

  local out
  out=$("$HERMES_INBOUND_SCRIPT" 2>/dev/null) || {
    record "hermes:inbound" fail "${HERMES_INBOUND_SCRIPT} exited non-zero"
    return 1
  }

  # Look for "status": "accepted" and a delivery_id
  if echo "$out" | grep -q '"status"[[:space:]]*:[[:space:]]*"accepted"' \
     && echo "$out" | grep -q '"delivery_id"'; then
    local id
    id=$(echo "$out" | sed -n 's/.*"delivery_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
    record "hermes:inbound" ok "delivery accepted (delivery_id=${id:-<unknown>})"
    return 0
  fi

  record "hermes:inbound" fail "unexpected response: $(echo "$out" | tr '\n' ' ' | cut -c1-160)"
  return 1
}

# ---- Run checks ------------------------------------------------------------

log "${c_bold}Hermes + task-worker + OpenClaw health check${c_reset}"
log "$(date -Is)"
log ""

check_listener "hermes"      "$HERMES_HOST"      "$HERMES_PORT"      || true
check_listener "task-worker" "$TASK_WORKER_HOST" "$TASK_WORKER_PORT" || true
check_listener "openclaw"    "$OPENCLAW_HOST"    "$OPENCLAW_PORT"    || true

check_task_worker_root || true
check_openclaw_root    || true
check_hermes_inbound   || true

# ---- Summary ---------------------------------------------------------------

if [[ $JSON -eq 1 ]]; then
  echo -n '{"checks":['
  first=1
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r name status detail <<<"$r"
    [[ $first -eq 1 ]] || echo -n ','
    first=0
    printf '{"name":"%s","status":"%s","detail":%s}' \
      "$name" "$status" "$(printf '%s' "$detail" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
  done
  echo -n '],"failures":'"$FAIL_COUNT"',"ok":'"$([[ $FAIL_COUNT -eq 0 ]] && echo true || echo false)"'}'
  echo
fi

log ""
if [[ $FAIL_COUNT -eq 0 ]]; then
  log "${c_green}${c_bold}All checks passed.${c_reset}"
  exit 0
else
  echo "${c_red}${c_bold}${FAIL_COUNT} check(s) failed.${c_reset}" >&2
  exit 1
fi