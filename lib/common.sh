#!/usr/bin/env zsh
# clawdad/lib/common.sh — Shared constants, path resolution, validation

# Paths
CLAWDAD_ROOT="${CLAWDAD_ROOT:-/Volumes/Code_2TB/code/clawdad}"
CLAWDAD_HOME="${CLAWDAD_HOME:-$HOME/.clawdad}"
CLAWDAD_STATE="$CLAWDAD_HOME/state.json"
CLAWDAD_LOG="${CLAWDAD_LOG:-$HOME/Library/Logs/clawdad.log}"
if [[ -f "$CLAWDAD_ROOT/package.json" ]]; then
  CLAWDAD_VERSION="$(
    sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$CLAWDAD_ROOT/package.json" | head -1
  )"
fi
CLAWDAD_VERSION="${CLAWDAD_VERSION:-dev}"

# ORP integration
CLAWDAD_ORP="${CLAWDAD_ORP:-orp}"
CLAWDAD_ORP_WORKSPACE="${CLAWDAD_ORP_WORKSPACE:-main}"

# Defaults
CLAWDAD_POLL_INTERVAL="${CLAWDAD_POLL_INTERVAL:-5}"
CLAWDAD_DISPATCH_TIMEOUT="${CLAWDAD_DISPATCH_TIMEOUT:-}"
CLAWDAD_PERMISSION_MODE="${CLAWDAD_PERMISSION_MODE:-plan}"
CLAWDAD_DEFAULT_PROVIDER="${CLAWDAD_DEFAULT_PROVIDER:-codex}"
CLAWDAD_CODEX_TURN_TIMEOUT_MS="${CLAWDAD_CODEX_TURN_TIMEOUT_MS:-1800000}"
CLAWDAD_CODEX_REQUEST_TIMEOUT_MS="${CLAWDAD_CODEX_REQUEST_TIMEOUT_MS:-120000}"
CLAWDAD_STALE_DISPATCH_TIMEOUT_MS="${CLAWDAD_STALE_DISPATCH_TIMEOUT_MS:-2100000}"
CLAWDAD_DISPATCH_HEARTBEAT_INTERVAL_SECONDS="${CLAWDAD_DISPATCH_HEARTBEAT_INTERVAL_SECONDS:-30}"

# Provider binaries (override via env)
CLAWDAD_JQ="${CLAWDAD_JQ:-jq}"
CLAWDAD_NODE="${CLAWDAD_NODE:-node}"
CLAWDAD_CODEX="${CLAWDAD_CODEX:-codex}"
CLAWDAD_CODEX_HOME="${CLAWDAD_CODEX_HOME:-$HOME/.codex}"
if [[ -z "${CLAWDAD_CHIMERA:-}" ]]; then
  if command -v chimera &>/dev/null; then
    CLAWDAD_CHIMERA="chimera"
  elif [[ -x "$CLAWDAD_ROOT/../Chimera/target/debug/chimera" ]]; then
    CLAWDAD_CHIMERA="$CLAWDAD_ROOT/../Chimera/target/debug/chimera"
  elif [[ -x "$CLAWDAD_ROOT/../Chimera/target/release/chimera" ]]; then
    CLAWDAD_CHIMERA="$CLAWDAD_ROOT/../Chimera/target/release/chimera"
  else
    CLAWDAD_CHIMERA="chimera"
  fi
fi
CLAWDAD_CHIMERA_MODEL="${CLAWDAD_CHIMERA_MODEL:-local}"
CLAWDAD_TMUX="${CLAWDAD_TMUX:-/opt/homebrew/bin/tmux}"

# Listener defaults
CLAWDAD_SERVER_HOST="${CLAWDAD_SERVER_HOST:-127.0.0.1}"
CLAWDAD_SERVER_PORT="${CLAWDAD_SERVER_PORT:-4477}"
CLAWDAD_SERVER_CONFIG_FILE="${CLAWDAD_SERVER_CONFIG_FILE:-$CLAWDAD_HOME/server.json}"
CLAWDAD_SERVER_TOKEN_FILE="${CLAWDAD_SERVER_TOKEN_FILE:-$CLAWDAD_HOME/server.token}"
CLAWDAD_SERVER_DEFAULT_PROJECT="${CLAWDAD_SERVER_DEFAULT_PROJECT:-}"
CLAWDAD_SERVER_BODY_LIMIT_BYTES="${CLAWDAD_SERVER_BODY_LIMIT_BYTES:-65536}"
CLAWDAD_SERVER_AUTH_MODE="${CLAWDAD_SERVER_AUTH_MODE:-token}"
CLAWDAD_SERVER_ALLOWED_USERS="${CLAWDAD_SERVER_ALLOWED_USERS:-}"
CLAWDAD_SERVER_REQUIRED_CAPABILITY="${CLAWDAD_SERVER_REQUIRED_CAPABILITY:-}"
CLAWDAD_SERVER_ALLOW_TAGGED_DEVICES="${CLAWDAD_SERVER_ALLOW_TAGGED_DEVICES:-false}"
CLAWDAD_SERVER_HTTPS_PORT="${CLAWDAD_SERVER_HTTPS_PORT:-443}"

# Supported providers
CLAWDAD_PROVIDERS=("codex" "chimera")

require_jq() {
  if ! command -v "$CLAWDAD_JQ" &>/dev/null; then
    echo "error: jq is required but not found" >&2
    exit 1
  fi
}

require_node() {
  if ! command -v "$CLAWDAD_NODE" &>/dev/null; then
    echo "error: node is required but not found" >&2
    exit 1
  fi
}

require_orp() {
  if ! command -v "$CLAWDAD_ORP" &>/dev/null; then
    echo "error: orp CLI is required but not found" >&2
    echo "hint: install from https://github.com/open-research-protocol/orp" >&2
    exit 1
  fi
}

require_provider() {
  local provider="${1:-$CLAWDAD_DEFAULT_PROVIDER}"
  local binary
  case "$provider" in
    codex)  binary="$CLAWDAD_CODEX" ;;
    chimera) binary="$CLAWDAD_CHIMERA" ;;
    *)
      echo "error: unknown provider '$provider' (supported: ${CLAWDAD_PROVIDERS[*]})" >&2
      exit 1
      ;;
  esac
  if ! command -v "$binary" &>/dev/null; then
    echo "error: $provider CLI ('$binary') is required but not found" >&2
    exit 1
  fi
}

require_tmux() {
  if [[ ! -x "$CLAWDAD_TMUX" ]]; then
    echo "error: tmux is required but not found at $CLAWDAD_TMUX" >&2
    exit 1
  fi
}

require_state() {
  if [[ ! -f "$CLAWDAD_STATE" ]]; then
    echo "error: clawdad not initialized — run 'clawdad init' first" >&2
    exit 1
  fi
}

# Query ORP tabs as JSON array
_orp_tabs_json() {
  "$CLAWDAD_ORP" workspace tabs "$CLAWDAD_ORP_WORKSPACE" --json 2>/dev/null
}

_orp_tabs_json_safe() {
  local tabs_json
  tabs_json=$(_orp_tabs_json 2>/dev/null || true)
  if [[ -n "$tabs_json" ]] && echo "$tabs_json" | "$CLAWDAD_JQ" -e '.tabs | arrays' >/dev/null 2>&1; then
    echo "$tabs_json"
    return 0
  fi
  printf '{"tabs":[],"tabCount":0}\n'
  return 0
}

_state_project_match() {
  local input="$1"
  [[ -n "$input" && -f "$CLAWDAD_STATE" ]] || return 1

  "$CLAWDAD_JQ" -r \
    --arg input "$input" '
      (.projects // {})
      | to_entries[]?
      | select(
          .key == $input
          or ((.key | split("/") | last) == $input)
          or any((.value.sessions // {}) | to_entries[]?; (.value.slug // "") == $input)
        )
      | .key
    ' "$CLAWDAD_STATE" 2>/dev/null | head -1
}

# Resolve a slug (title) or path to the project path from ORP tabs.
resolve_project() {
  local input="$1"
  require_state

  # Fast path for already-resolved absolute project directories.
  if [[ "$input" == /* && -d "$input" ]]; then
    local resolved_input
    resolved_input="$(cd "$input" 2>/dev/null && pwd -P)" || true
    if [[ -n "$resolved_input" ]]; then
      echo "$resolved_input"
      return 0
    fi
  fi

  local state_match
  state_match=$(_state_project_match "$input" || true)
  if [[ -n "$state_match" && -d "$state_match" ]]; then
    echo "$state_match"
    return 0
  fi

  local tabs_json
  tabs_json=$(_orp_tabs_json_safe || true)

  # Try as absolute path first
  if [[ "$input" == /* ]]; then
    local match
    match=$(echo "$tabs_json" | "$CLAWDAD_JQ" -r \
      --arg path "$input" \
      '.tabs[] | select(.path == $path) | .path' | head -1)
    if [[ -n "$match" ]]; then
      echo "$match"
      return 0
    fi
  fi

  # Try as title/slug
  local match
  match=$(echo "$tabs_json" | "$CLAWDAD_JQ" -r \
    --arg title "$input" \
    '.tabs[] | select(.title == $title) | .path' | head -1)
  if [[ -n "$match" ]]; then
    echo "$match"
    return 0
  fi

  # Try matching basename of path
  match=$(echo "$tabs_json" | "$CLAWDAD_JQ" -r \
    --arg slug "$input" \
    '.tabs[] | select((.path | split("/") | last) == $slug) | .path' | head -1)
  if [[ -n "$match" ]]; then
    echo "$match"
    return 0
  fi

  # Try resolving as relative path
  local resolved
  resolved="$(cd "$input" 2>/dev/null && pwd -P)" || true
  if [[ -n "$resolved" ]]; then
    state_match=$(_state_project_match "$resolved" || true)
    if [[ -n "$state_match" && -d "$state_match" ]]; then
      echo "$state_match"
      return 0
    fi
    match=$(echo "$tabs_json" | "$CLAWDAD_JQ" -r \
      --arg path "$resolved" \
      '.tabs[] | select(.path == $path) | .path' | head -1)
    if [[ -n "$match" ]]; then
      echo "$match"
      return 0
    fi
  fi

  echo "error: project '$input' not found in ORP workspace '$CLAWDAD_ORP_WORKSPACE'" >&2
  return 1
}

# Get a field from an ORP tab by path
orp_tab_field() {
  local project_path="$1" field="$2"
  _orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    ".tabs[] | select(.path == \$path) | .$field // \"\""
}

# Get a field from local dispatch state
state_field() {
  local project_path="$1" field="$2"
  if [[ -f "$CLAWDAD_STATE" ]]; then
    "$CLAWDAD_JQ" -r \
      --arg path "$project_path" \
      ".projects[\$path].$field // \"\"" "$CLAWDAD_STATE" 2>/dev/null
  fi
}

iso_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

gen_uuid() {
  uuidgen | tr '[:upper:]' '[:lower:]'
}

to_absolute_path() {
  local path="$1"
  if [[ -d "$path" ]]; then
    cd "$path" 2>/dev/null && pwd -P
  elif [[ "$path" == /* ]]; then
    echo "$path"
  else
    echo "$(cd "$path" 2>/dev/null && pwd -P)"
  fi
}
