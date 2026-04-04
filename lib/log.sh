#!/usr/bin/env zsh
# clawdad/lib/log.sh — Timestamped logging helpers

# Ensure log directory exists
[[ -d "${CLAWDAD_LOG%/*}" ]] || mkdir -p "${CLAWDAD_LOG%/*}"

_clawdad_log() {
  local level="$1"; shift
  local ts
  ts="$(date +"%Y-%m-%d %H:%M:%S")"
  echo "[$ts] [$level] $*" >> "$CLAWDAD_LOG"
}

clawdad_log() {
  _clawdad_log "INFO" "$@"
}

clawdad_info() {
  echo "$@"
  _clawdad_log "INFO" "$@"
}

clawdad_warn() {
  echo "warning: $*" >&2
  _clawdad_log "WARN" "$@"
}

clawdad_error() {
  echo "error: $*" >&2
  _clawdad_log "ERROR" "$@"
}
