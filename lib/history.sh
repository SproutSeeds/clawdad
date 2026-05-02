#!/usr/bin/env zsh
# clawdad/lib/history.sh — Persistent per-session history records

history_dir() {
  local project_path="$1"
  echo "$project_path/.clawdad/history"
}

history_sessions_dir() {
  local project_path="$1"
  echo "$(history_dir "$project_path")/sessions"
}

history_requests_dir() {
  local project_path="$1"
  echo "$(history_dir "$project_path")/requests"
}

history_sanitize_key() {
  local value="$1"
  value="${value//[^A-Za-z0-9._-]/_}"
  echo "$value"
}

history_session_dir() {
  local project_path="$1" session_id="$2"
  local safe_session
  safe_session="$(history_sanitize_key "$session_id")"
  echo "$(history_sessions_dir "$project_path")/$safe_session"
}

history_request_stamp() {
  local iso_value="$1"
  local stamp="${iso_value//[-:]/}"
  stamp="${stamp// /_}"
  echo "$stamp"
}

history_request_file() {
  local project_path="$1" session_id="$2" request_id="$3" sent_at="$4"
  local session_dir stamp
  session_dir="$(history_session_dir "$project_path" "$session_id")"
  stamp="$(history_request_stamp "$sent_at")"
  echo "$session_dir/${stamp}--${request_id}.json"
}

history_request_index_file() {
  local project_path="$1" request_id="$2"
  echo "$(history_requests_dir "$project_path")/${request_id}.json"
}

history_init() {
  local project_path="$1"
  mkdir -p "$(history_sessions_dir "$project_path")" "$(history_requests_dir "$project_path")"
}

_history_write_json() {
  local file_path="$1" payload="$2"
  local tmp
  mkdir -p "${file_path:h}"
  tmp=$(mktemp "${file_path}.tmp.XXXXXX") || return 1
  printf '%s\n' "$payload" > "$tmp"
  mv "$tmp" "$file_path"
}

history_write_request() {
  local project_path="$1" request_id="$2" session_id="$3" slug="$4" provider="$5" message="$6" sent_at="$7"
  local record_file index_file record_payload index_payload

  history_init "$project_path"
  record_file="$(history_request_file "$project_path" "$session_id" "$request_id" "$sent_at")"
  index_file="$(history_request_index_file "$project_path" "$request_id")"

  record_payload=$(
    "$CLAWDAD_JQ" -n \
      --arg requestId "$request_id" \
      --arg projectPath "$project_path" \
      --arg sessionId "$session_id" \
      --arg sessionSlug "$slug" \
      --arg provider "$provider" \
      --arg message "$message" \
      --arg sentAt "$sent_at" \
      '{
        requestId: $requestId,
        projectPath: $projectPath,
        sessionId: $sessionId,
        sessionSlug: $sessionSlug,
        provider: $provider,
        message: $message,
        sentAt: $sentAt,
        answeredAt: null,
        status: "queued",
        exitCode: null,
        response: ""
      }'
  ) || return 1

  index_payload=$(
    "$CLAWDAD_JQ" -n \
      --arg requestId "$request_id" \
      --arg sessionId "$session_id" \
      --arg sentAt "$sent_at" \
      --arg file "$record_file" \
      '{
        requestId: $requestId,
        sessionId: $sessionId,
        sentAt: $sentAt,
        file: $file
      }'
  ) || return 1

  _history_write_json "$record_file" "$record_payload" || return 1
  _history_write_json "$index_file" "$index_payload"
}

history_update_result() {
  local project_path="$1" request_id="$2" session_id="$3" slug="$4" provider="$5"
  local outcome="$6" exit_code="$7" answered_at="$8" response="$9"
  local index_file sent_at existing_file target_file payload index_payload

  history_init "$project_path"
  index_file="$(history_request_index_file "$project_path" "$request_id")"
  sent_at="$answered_at"
  existing_file=""

  if [[ -f "$index_file" ]]; then
    sent_at=$("$CLAWDAD_JQ" -r '.sentAt // empty' "$index_file" 2>/dev/null || echo "")
    existing_file=$("$CLAWDAD_JQ" -r '.file // empty' "$index_file" 2>/dev/null || echo "")
  fi

  if [[ "$outcome" == "failed" && -n "$existing_file" && -f "$existing_file" ]]; then
    local existing_status existing_response
    existing_status=$("$CLAWDAD_JQ" -r '.status // ""' "$existing_file" 2>/dev/null || echo "")
    existing_response=$("$CLAWDAD_JQ" -r '.response // ""' "$existing_file" 2>/dev/null || echo "")
    if [[ "$existing_status" == "answered" && -n "$existing_response" ]]; then
      clawdad_log "history skipped late failed result for answered request_id=$request_id"
      return 0
    fi
  fi

  [[ -z "$sent_at" ]] && sent_at="$answered_at"
  target_file="$(history_request_file "$project_path" "$session_id" "$request_id" "$sent_at")"

  if [[ -n "$existing_file" && "$existing_file" != "$target_file" && -f "$existing_file" ]]; then
    mkdir -p "${target_file:h}"
    mv "$existing_file" "$target_file"
  fi

  if [[ -f "$target_file" ]]; then
    payload=$(
      "$CLAWDAD_JQ" \
        --arg sessionId "$session_id" \
        --arg sessionSlug "$slug" \
        --arg provider "$provider" \
        --arg status "$outcome" \
        --arg answeredAt "$answered_at" \
        --arg response "$response" \
        --argjson exitCode "${exit_code:-0}" \
        '
          .sessionId = $sessionId
          | .sessionSlug = $sessionSlug
          | .provider = $provider
          | .status = $status
          | .answeredAt = $answeredAt
          | .exitCode = $exitCode
          | .response = $response
        ' "$target_file"
    ) || return 1
  else
    payload=$(
      "$CLAWDAD_JQ" -n \
        --arg requestId "$request_id" \
        --arg projectPath "$project_path" \
        --arg sessionId "$session_id" \
        --arg sessionSlug "$slug" \
        --arg provider "$provider" \
        --arg sentAt "$sent_at" \
        --arg answeredAt "$answered_at" \
        --arg status "$outcome" \
        --arg response "$response" \
        --argjson exitCode "${exit_code:-0}" \
        '{
          requestId: $requestId,
          projectPath: $projectPath,
          sessionId: $sessionId,
          sessionSlug: $sessionSlug,
          provider: $provider,
          message: "",
          sentAt: $sentAt,
          answeredAt: $answeredAt,
          status: $status,
          exitCode: $exitCode,
          response: $response
        }'
    ) || return 1
  fi

  index_payload=$(
    "$CLAWDAD_JQ" -n \
      --arg requestId "$request_id" \
      --arg sessionId "$session_id" \
      --arg sentAt "$sent_at" \
      --arg file "$target_file" \
      '{
        requestId: $requestId,
        sessionId: $sessionId,
        sentAt: $sentAt,
        file: $file
      }'
  ) || return 1

  _history_write_json "$target_file" "$payload" || return 1
  _history_write_json "$index_file" "$index_payload"
}
