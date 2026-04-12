#!/usr/bin/env zsh
# clawdad/lib/mailbox.sh — Per-project mailbox init, read, write, status

mailbox_dir() {
  local project_path="$1"
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
  local mbox
  mbox="$(mailbox_dir "$project_path")"
  mkdir -p "$mbox"
  local ts
  ts="$(iso_timestamp)"

  local dispatched_at="null"
  local completed_at="null"

  case "$state" in
    dispatched|running)
      dispatched_at="\"$ts\""
      ;;
    completed|failed)
      completed_at="\"$ts\""
      # Preserve dispatched_at from existing status
      if [[ -f "$mbox/status.json" ]]; then
        dispatched_at=$("$CLAWDAD_JQ" -r '.dispatched_at // "null"' "$mbox/status.json")
        [[ "$dispatched_at" != "null" ]] && dispatched_at="\"$dispatched_at\""
      fi
      ;;
  esac

  [[ "$request_id" != "null" ]] && request_id="\"$request_id\""
  [[ "$error" != "null" ]] && error="\"$error\""
  [[ "$session_id" != "null" ]] && session_id="\"$session_id\""

  local payload
  payload=$(cat <<EOF
{
  "state": "$state",
  "request_id": $request_id,
  "session_id": $session_id,
  "dispatched_at": $dispatched_at,
  "completed_at": $completed_at,
  "error": $error,
  "pid": $pid
}
EOF
)

  _mailbox_write_file "$mbox/status.json" "$payload" || return 1
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
