#!/usr/bin/env zsh
# clawdad/lib/mailbox.sh — Per-project mailbox init, read, write, status

mailbox_dir() {
  local project_path="$1"
  if [[ -n "${CLAWDAD_MAILBOX_DIR:-}" ]]; then
    echo "$CLAWDAD_MAILBOX_DIR"
    return 0
  fi
  echo "$project_path/.clawdad/mailbox"
}

_mailbox_write_file() {
  local target_file="$1" content="$2"
  local tmp
  mkdir -p "${target_file:h}"
  tmp=$(mktemp "${target_file}.tmp.XXXXXX") || return 1
  printf '%s\n' "$content" > "$tmp"
  mv "$tmp" "$target_file"
}

_mailbox_json_string_or_null() {
  local value="${1:-null}"
  if [[ -z "$value" || "$value" == "null" ]]; then
    printf 'null'
    return 0
  fi

  printf '%s' "$value" | "$CLAWDAD_JQ" -Rs .
}

_mailbox_json_pid_or_null() {
  local value="${1:-null}"
  if [[ -z "$value" || "$value" == "null" ]]; then
    printf 'null'
    return 0
  fi
  if [[ "$value" == <-> ]]; then
    printf '%s' "$value"
    return 0
  fi
  printf 'null'
}

mailbox_request_is_completed() {
  local project_path="$1" request_id="$2"
  [[ -n "$request_id" && "$request_id" != "null" ]] || return 1

  local mbox status_file current_state current_request
  mbox="$(mailbox_dir "$project_path")"
  status_file="$mbox/status.json"
  [[ -f "$status_file" ]] || return 1

  current_state=$("$CLAWDAD_JQ" -r '.state // ""' "$status_file" 2>/dev/null || printf '')
  current_request=$("$CLAWDAD_JQ" -r '.request_id // ""' "$status_file" 2>/dev/null || printf '')
  [[ "$current_state" == "completed" && "$current_request" == "$request_id" ]]
}

mailbox_init() {
  local project_path="$1"
  local mbox
  mbox="$(mailbox_dir "$project_path")"

  mkdir -p "$mbox"

  # Initialize status if it doesn't exist
  if [[ ! -f "$mbox/status.json" ]]; then
    mailbox_update_status "$project_path" "idle"
  fi

  # Copy project README template
  local readme="$project_path/.clawdad/README.md"
  if [[ ! -f "$readme" ]] && [[ -f "$CLAWDAD_ROOT/templates/CLAWDAD_PROJECT.md" ]]; then
    cp "$CLAWDAD_ROOT/templates/CLAWDAD_PROJECT.md" "$readme"
  fi

  clawdad_log "Initialized mailbox at $mbox"
}

mailbox_write_request() {
  local project_path="$1" request_id="$2" message="$3"
  local mbox
  mbox="$(mailbox_dir "$project_path")"
  mkdir -p "$mbox"
  local ts
  ts="$(iso_timestamp)"

  local payload
  payload=$(cat <<EOF
# Request: $request_id

Dispatched: $ts
From: hub

---

$message
EOF
)

  _mailbox_write_file "$mbox/request.md" "$payload" || return 1

  clawdad_log "Wrote request $request_id to $mbox/request.md"
}

mailbox_write_response() {
  local project_path="$1" request_id="$2" session_id="$3" exit_code="$4" content="$5"
  if [[ "$exit_code" != "0" ]] && mailbox_request_is_completed "$project_path" "$request_id"; then
    clawdad_log "Skipped late failed response for completed request $request_id"
    return 0
  fi

  local mbox
  mbox="$(mailbox_dir "$project_path")"
  mkdir -p "$mbox"
  local ts
  ts="$(iso_timestamp)"

  local payload
  payload=$(cat <<EOF
# Response: $request_id

Completed: $ts
Session: $session_id
Exit code: $exit_code

---

$content
EOF
)

  _mailbox_write_file "$mbox/response.md" "$payload" || return 1

  clawdad_log "Wrote response $request_id to $mbox/response.md"
}

mailbox_update_status() {
  local project_path="$1" state="$2"
  local request_id="${3:-null}"
  local pid="${4:-null}"
  local error="${5:-null}"
  local session_id="${6:-null}"
  if [[ "$state" == "failed" ]] && mailbox_request_is_completed "$project_path" "$request_id"; then
    clawdad_log "Skipped late failed status for completed request $request_id"
    return 0
  fi

  local mbox
  mbox="$(mailbox_dir "$project_path")"
  mkdir -p "$mbox"
  local ts
  ts="$(iso_timestamp)"

  local dispatched_at=""
  local completed_at=""
  local heartbeat_at=""

  case "$state" in
    dispatched|running)
      dispatched_at="$ts"
      heartbeat_at="$ts"
      ;;
    completed|failed)
      completed_at="$ts"
      # Preserve dispatched_at from existing status
      if [[ -f "$mbox/status.json" ]]; then
        dispatched_at=$("$CLAWDAD_JQ" -r '.dispatched_at // ""' "$mbox/status.json" 2>/dev/null || printf '')
        [[ "$dispatched_at" == "null" ]] && dispatched_at=""
        heartbeat_at=$("$CLAWDAD_JQ" -r '.heartbeat_at // ""' "$mbox/status.json" 2>/dev/null || printf '')
        [[ "$heartbeat_at" == "null" ]] && heartbeat_at=""
      fi
      ;;
  esac

  local request_id_json error_json session_id_json pid_json
  request_id_json=$(_mailbox_json_string_or_null "$request_id") || return 1
  error_json=$(_mailbox_json_string_or_null "$error") || return 1
  session_id_json=$(_mailbox_json_string_or_null "$session_id") || return 1
  pid_json=$(_mailbox_json_pid_or_null "$pid") || return 1

  local payload
  payload=$(
    "$CLAWDAD_JQ" -n \
      --arg state "$state" \
      --arg dispatched_at "$dispatched_at" \
      --arg completed_at "$completed_at" \
      --arg heartbeat_at "$heartbeat_at" \
      --argjson request_id "$request_id_json" \
      --argjson session_id "$session_id_json" \
      --argjson error "$error_json" \
      --argjson pid "$pid_json" \
      '{
        state: $state,
        request_id: $request_id,
        session_id: $session_id,
        dispatched_at: (if $dispatched_at == "" then null else $dispatched_at end),
        completed_at: (if $completed_at == "" then null else $completed_at end),
        heartbeat_at: (if $heartbeat_at == "" then null else $heartbeat_at end),
        error: $error,
        pid: $pid
      }'
  ) || return 1

  _mailbox_write_file "$mbox/status.json" "$payload" || return 1
}

mailbox_update_heartbeat() {
  local project_path="$1" request_id="$2" pid="${3:-null}" session_id="${4:-null}"
  local mbox
  mbox="$(mailbox_dir "$project_path")"
  local status_file="$mbox/status.json"
  [[ -f "$status_file" ]] || return 0

  local ts
  ts="$(iso_timestamp)"

  local request_id_json session_id_json pid_json
  request_id_json=$(_mailbox_json_string_or_null "$request_id") || return 1
  session_id_json=$(_mailbox_json_string_or_null "$session_id") || return 1
  pid_json=$(_mailbox_json_pid_or_null "$pid") || return 1

  local payload
  payload=$(
    "$CLAWDAD_JQ" \
      --arg heartbeat_at "$ts" \
      --argjson request_id "$request_id_json" \
      --argjson session_id "$session_id_json" \
      --argjson pid "$pid_json" \
      'if (.request_id == $request_id and ((.state // "") == "running" or (.state // "") == "dispatched")) then
        . + {
          heartbeat_at: $heartbeat_at,
          session_id: (if $session_id == null then .session_id else $session_id end),
          pid: (if $pid == null then .pid else $pid end)
        }
      else
        .
      end' "$status_file"
  ) || return 1

  _mailbox_write_file "$status_file" "$payload" || return 1
}

mailbox_read_status() {
  local project_path="$1"
  local mbox
  mbox="$(mailbox_dir "$project_path")"
  local status_file="$mbox/status.json"

  if [[ -f "$status_file" ]]; then
    "$CLAWDAD_JQ" -r '.state' "$status_file"
  else
    echo "unknown"
  fi
}

mailbox_read_response() {
  local project_path="$1"
  local mbox
  mbox="$(mailbox_dir "$project_path")"
  local response_file="$mbox/response.md"

  if [[ -f "$response_file" ]]; then
    cat "$response_file"
  else
    echo "(no response available)"
  fi
}

mailbox_read_response_raw() {
  local project_path="$1"
  local mbox
  mbox="$(mailbox_dir "$project_path")"
  local response_file="$mbox/response.md"

  if [[ -f "$response_file" ]]; then
    # Extract content after the --- separator
    sed -n '/^---$/,$ { /^---$/d; p; }' "$response_file"
  else
    echo "(no response available)"
  fi
}
