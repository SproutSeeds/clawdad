#!/usr/bin/env zsh
# clawdad/lib/dispatch.sh — Provider-agnostic dispatch to spoke agents

_build_cmd_codex() {
  local message="$1" session_id="$2" session_seeded="$3"
  local permission_mode="$4" model="$5" project_path="$6"

  require_node

  cmd=(
    "$CLAWDAD_NODE"
    "$CLAWDAD_ROOT/lib/codex-app-server-dispatch.mjs"
    "--project-path" "$project_path"
    "--message" "$message"
    "--session-id" "$session_id"
    "--permission-mode" "$permission_mode"
    "--codex-binary" "$CLAWDAD_CODEX"
  )

  if [[ "$session_seeded" == "true" ]]; then
    cmd+=("--session-seeded")
  fi

  if [[ -n "$model" ]]; then
    cmd+=("--model" "$model")
  fi

  local turn_timeout_ms="${CLAWDAD_CODEX_TURN_TIMEOUT_MS:-${CLAWDAD_WORKER_TIMEOUT_MS:-1800000}}"
  if [[ -n "$turn_timeout_ms" ]]; then
    cmd+=("--turn-timeout-ms" "$turn_timeout_ms")
  fi

  local request_timeout_ms="${CLAWDAD_CODEX_REQUEST_TIMEOUT_MS:-120000}"
  if [[ -n "$request_timeout_ms" ]]; then
    cmd+=("--request-timeout-ms" "$request_timeout_ms")
  fi
}

_build_cmd_chimera() {
  local project_path="$1" message="$2" session_id="$3" session_seeded="$4"
  local permission_mode="$5" model="$6"
  local chimera_model="${model:-$CLAWDAD_CHIMERA_MODEL}"

  cmd=(
    "$CLAWDAD_NODE"
    "$CLAWDAD_ROOT/lib/chimera-dispatch.mjs"
    "--project-path" "$project_path"
    "--message" "$message"
    "--session-id" "$session_id"
    "--permission-mode" "$permission_mode"
    "--model" "$chimera_model"
    "--chimera-binary" "$CLAWDAD_CHIMERA"
    "--home-dir" "$HOME"
  )

  if [[ "$session_seeded" == "true" ]]; then
    cmd+=("--session-seeded")
  fi

}

_build_dispatch_command() {
  local project_path="$1" message="$2" session_id="$3" dispatch_count="$4"
  local provider="$5" session_seeded="$6" permission_mode="$7" model="$8"

  cmd=()

  case "$provider" in
    codex)
      _build_cmd_codex "$message" "$session_id" "$session_seeded" "$permission_mode" "$model" "$project_path"
      ;;
    chimera)
      _build_cmd_chimera "$project_path" "$message" "$session_id" "$session_seeded" "$permission_mode" "$model"
      ;;
    *)
      clawdad_error "Unknown provider: $provider"
      return 1
      ;;
  esac
}

_artifact_augmented_message() {
  local project_path="$1" message="$2"
  local artifact_dir="${CLAWDAD_ARTIFACTS_DIR:-$project_path/.clawdad/artifacts}"
  printf '%s\n\n%s\n' "$message" "[Clawdad artifact handoff: If you create a deliverable file the user may need to download or share, save it under '$artifact_dir' using a clear filename. Create that folder if needed. Mention the saved filename in your final reply. Clawdad will surface files from that folder in the mobile app.]"
}

_extract_result_codex() {
  local output="$1"
  local result_text
  result_text=$(printf '%s' "$output" | "$CLAWDAD_JQ" -r '.result_text // ""' 2>/dev/null || true)
  if [[ -n "$result_text" && "$result_text" != "null" ]]; then
    printf '%s\n' "$result_text"
  else
    printf '%s\n' "$output"
  fi
}

_extract_codex_session_id() {
  local output="$1"
  printf '%s' "$output" | "$CLAWDAD_JQ" -r '.session_id // ""' 2>/dev/null
}

_extract_codex_error_text() {
  local output="$1"
  printf '%s' "$output" | "$CLAWDAD_JQ" -r '.error_text // ""' 2>/dev/null
}

_codex_error_is_transport_disconnect() {
  local error_text="$1"
  [[ "$error_text" == *"responseStreamDisconnected"* ]] ||
    [[ "$error_text" == *"stream disconnected before completion"* ]] ||
    [[ "$error_text" == *"websocket closed by server before response.completed"* ]]
}

_validate_codex_session_binding() {
  local project_path="$1" session_id="$2" session_seeded="$3"
  if [[ "$session_seeded" != "true" ]]; then
    return 0
  fi

  require_node

  local result count
  if ! result=$(
    "$CLAWDAD_NODE" "$CLAWDAD_ROOT/lib/codex-session-discovery.mjs" \
      "--cwd" "$project_path" \
      "--codex-home" "$CLAWDAD_CODEX_HOME" \
      "--list" \
      "--limit" "0" \
      "--session-id" "$session_id" 2>&1
  ); then
    clawdad_error "Could not validate Codex session '$session_id' for $project_path: $result"
    return 1
  fi

  count=$(printf '%s' "$result" | "$CLAWDAD_JQ" -r '(.sessions // []) | length' 2>/dev/null || echo "0")
  if [[ "$count" =~ ^[0-9]+$ ]] && (( count > 0 )); then
    return 0
  fi

  clawdad_error "Codex session '$session_id' is not a saved Codex session for $project_path. Select or import a session saved from this project, or run 'clawdad sessions-doctor --repair' to quarantine stale bindings."
  return 1
}

_record_codex_transport_failure() {
  local project_path="$1" session_id="$2" error_text="$3"
  local count
  count=$(state_session_field "$project_path" "$session_id" "transport_failure_count")
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
  count=$((count + 1))
  state_update_session "$project_path" "$session_id" "transport_failure_count" "$count" || true
  state_update_session "$project_path" "$session_id" "last_error_kind" "codex_transport_disconnect" || true
  state_update_session "$project_path" "$session_id" "last_error_text" "$error_text" || true
  if (( count >= 2 )); then
    state_quarantine_session "$project_path" "$session_id" "repeated_codex_transport_disconnect" "$error_text" || true
  fi
}

_clear_codex_transport_failure() {
  local project_path="$1" session_id="$2"
  state_update_session "$project_path" "$session_id" "transport_failure_count" "0" || true
  state_update_session "$project_path" "$session_id" "last_error_kind" "" || true
  state_update_session "$project_path" "$session_id" "last_error_text" "" || true
}

_extract_result_chimera() {
  local output="$1"
  printf '%s' "$output" | "$CLAWDAD_JQ" -r '.result_text // ""' 2>/dev/null
}

_extract_chimera_session_id() {
  local output="$1"
  printf '%s' "$output" | "$CLAWDAD_JQ" -r '.session_id // ""' 2>/dev/null
}

_extract_chimera_error_text() {
  local output="$1"
  printf '%s' "$output" | "$CLAWDAD_JQ" -r '.error_text // ""' 2>/dev/null
}

dispatch_to_spoke() {
  local project_path="$1" message="$2"
  local permission_mode="${3:-$CLAWDAD_PERMISSION_MODE}"
  local model="${4:-}"
  local session_selector="${5:-}"
  local persist_active="${6:-true}"

  # Resolve the active tracked session for this project bucket.
  local session_json
  session_json=$(registry_session_json "$project_path" "$session_selector") || {
    clawdad_error "No tracked session found for project. Register it first: clawdad register $project_path"
    return 1
  }

  local session_id slug dispatch_count provider
  session_id=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.resumeSessionId // ""')
  slug=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.title // ""')
  dispatch_count=$(state_session_field "$project_path" "$session_id" "dispatch_count")
  provider=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.resumeTool // ""')
  local session_seeded=""
  session_seeded=$(state_session_field "$project_path" "$session_id" "provider_session_seeded")

  # Validate session_id
  if [[ -z "$session_id" || "$session_id" == "null" ]]; then
    clawdad_error "No session ID found for project. Register it first: clawdad register $project_path"
    return 1
  fi

  if state_session_is_quarantined "$project_path" "$session_id"; then
    local quarantine_reason
    quarantine_reason=$(state_session_quarantine_reason "$project_path" "$session_id")
    clawdad_error "Session '$slug' ($session_id) is quarantined: ${quarantine_reason:-quarantined}. Add or select a fresh session before dispatching."
    return 1
  fi

  # Default provider if not set
  [[ -z "$provider" || "$provider" == "null" ]] && provider="$CLAWDAD_DEFAULT_PROVIDER"

  # Ensure local state exists for this project
  state_ensure_project "$project_path"
  mailbox_init "$project_path"
  history_init "$project_path"

  # Default session state if empty or non-numeric
  if [[ ! "$dispatch_count" =~ ^[0-9]+$ ]]; then
    dispatch_count=0
  fi
  if [[ -z "$session_seeded" || "$session_seeded" == "null" ]]; then
    session_seeded="true"
  fi

  # Validate provider is available
  require_provider "$provider"
  if [[ "$provider" == "codex" ]]; then
    _validate_codex_session_binding "$project_path" "$session_id" "$session_seeded" || return 1
  fi

  # Check if already running
  local current_status
  current_status=$(mailbox_read_status "$project_path")
  if [[ "$current_status" == "running" ]]; then
    clawdad_error "Project '$slug' already has a running dispatch. Use 'clawdad status $slug' to check."
    return 1
  fi

  # Generate request ID
  local request_id
  request_id=$(gen_uuid)
  local started_at
  started_at=$(iso_timestamp)

  # Write request to mailbox
  mailbox_write_request "$project_path" "$request_id" "$message"
  history_write_request "$project_path" "$request_id" "$session_id" "$slug" "$provider" "$message" "$started_at" || \
    clawdad_log "history warning: failed to write request record for $slug request_id=$request_id"
  mailbox_update_status "$project_path" "dispatched" "$request_id" "" "" "$session_id"
  registry_update "$project_path" "status" "running"
  registry_update "$project_path" "last_dispatch" "$started_at"
  state_update_session "$project_path" "$session_id" "status" "running"
  state_update_session "$project_path" "$session_id" "last_dispatch" "$started_at"
  if [[ "$persist_active" == "true" ]]; then
    state_set_active_session "$project_path" "$session_id"
  fi

  local -a cmd
  local codex_output_file=""
  local agent_message
  agent_message=$(_artifact_augmented_message "$project_path" "$message")
  _build_dispatch_command "$project_path" "$agent_message" "$session_id" "$dispatch_count" "$provider" "$session_seeded" "$permission_mode" "$model" || return 1
  if [[ "$provider" == "codex" && -z "${CLAWDAD_CODEX_EVENT_LOG_FILE:-}" ]]; then
    local codex_event_dir="$project_path/.clawdad/history/events"
    mkdir -p "$codex_event_dir" 2>/dev/null || true
    export CLAWDAD_CODEX_EVENT_LOG_FILE="$codex_event_dir/$request_id.codex-events.jsonl"
  fi

  # Launch a detached worker process so the dispatch survives after this CLI exits.
  nohup "$CLAWDAD_ROOT/lib/dispatch-worker.sh" \
    "$project_path" \
    "$request_id" \
    "$session_id" \
    "$slug" \
    "$provider" \
    "$session_seeded" \
    "$dispatch_count" \
    "$permission_mode" \
    "$model" \
    "$persist_active" \
    "$agent_message" >/dev/null 2>&1 </dev/null &
  local bg_pid=$!

  mailbox_update_status "$project_path" "running" "$request_id" "$bg_pid" "" "$session_id"

  clawdad_info "Dispatched request $request_id to $slug via $provider (pid: $bg_pid)"
  clawdad_log "dispatch: slug=$slug provider=$provider request_id=$request_id pid=$bg_pid cmd=${cmd[*]}"
}

_dispatch_background() {
  local project_path="$1" request_id="$2" session_id="$3" slug="$4" provider="$5"
  local session_seeded="${6:-}" dispatch_count="${7:-0}" permission_mode="${8:-$CLAWDAD_PERMISSION_MODE}"
  local model="${9:-}" persist_active="${10:-true}" message="${11:-}"

  _CLAWDAD_DISPATCH_FINALIZED=false
  _CLAWDAD_DISPATCH_PROJECT_PATH="$project_path"
  _CLAWDAD_DISPATCH_REQUEST_ID="$request_id"
  _CLAWDAD_DISPATCH_SESSION_ID="$session_id"
  _CLAWDAD_DISPATCH_SLUG="$slug"
  _CLAWDAD_DISPATCH_PROVIDER="$provider"
  _CLAWDAD_DISPATCH_ERROR=""
  _CLAWDAD_DISPATCH_CHILD_PID=""
  _CLAWDAD_DISPATCH_HEARTBEAT_PID=""

  _dispatch_fail_unfinalized() {
    local exit_code=$?
    if [[ ! "$exit_code" =~ ^[0-9]+$ ]] || (( exit_code == 0 )); then
      exit_code=1
    fi
    if [[ "${_CLAWDAD_DISPATCH_FINALIZED:-false}" == "true" ]]; then
      return "$exit_code"
    fi
    if [[ -z "${_CLAWDAD_DISPATCH_PROJECT_PATH:-}" || -z "${_CLAWDAD_DISPATCH_REQUEST_ID:-}" ]]; then
      return "$exit_code"
    fi

    _CLAWDAD_DISPATCH_FINALIZED=true
    if [[ -n "${_CLAWDAD_DISPATCH_CHILD_PID:-}" ]] && kill -0 "$_CLAWDAD_DISPATCH_CHILD_PID" 2>/dev/null; then
      kill -TERM "$_CLAWDAD_DISPATCH_CHILD_PID" 2>/dev/null || true
    fi
    if [[ -n "${_CLAWDAD_DISPATCH_HEARTBEAT_PID:-}" ]] && kill -0 "$_CLAWDAD_DISPATCH_HEARTBEAT_PID" 2>/dev/null; then
      kill -TERM "$_CLAWDAD_DISPATCH_HEARTBEAT_PID" 2>/dev/null || true
    fi
    if mailbox_request_is_completed "$_CLAWDAD_DISPATCH_PROJECT_PATH" "$_CLAWDAD_DISPATCH_REQUEST_ID"; then
      clawdad_log "dispatch failure ignored after completed recovery: slug=$_CLAWDAD_DISPATCH_SLUG provider=$_CLAWDAD_DISPATCH_PROVIDER request_id=$_CLAWDAD_DISPATCH_REQUEST_ID exit=${exit_code:-1}"
      return 0
    fi
    local error_msg="${_CLAWDAD_DISPATCH_ERROR:-dispatch worker exited before completing (exit ${exit_code})}"
    local completed_at
    completed_at="$(iso_timestamp)"
    mailbox_write_response "$_CLAWDAD_DISPATCH_PROJECT_PATH" "$_CLAWDAD_DISPATCH_REQUEST_ID" "$_CLAWDAD_DISPATCH_SESSION_ID" "${exit_code:-1}" "$error_msg" || true
    history_update_result "$_CLAWDAD_DISPATCH_PROJECT_PATH" "$_CLAWDAD_DISPATCH_REQUEST_ID" "$_CLAWDAD_DISPATCH_SESSION_ID" "$_CLAWDAD_DISPATCH_SLUG" "$_CLAWDAD_DISPATCH_PROVIDER" "failed" "${exit_code:-1}" "$completed_at" "$error_msg" || \
      clawdad_log "history warning: failed to write abandoned response record for $_CLAWDAD_DISPATCH_SLUG request_id=$_CLAWDAD_DISPATCH_REQUEST_ID"
    mailbox_update_status "$_CLAWDAD_DISPATCH_PROJECT_PATH" "failed" "$_CLAWDAD_DISPATCH_REQUEST_ID" "" "$error_msg" "$_CLAWDAD_DISPATCH_SESSION_ID" || true
    registry_update "$_CLAWDAD_DISPATCH_PROJECT_PATH" "status" "failed" || true
    registry_update "$_CLAWDAD_DISPATCH_PROJECT_PATH" "last_response" "$completed_at" || true
    registry_increment "$_CLAWDAD_DISPATCH_PROJECT_PATH" "dispatch_count" || true
    state_update_session "$_CLAWDAD_DISPATCH_PROJECT_PATH" "$_CLAWDAD_DISPATCH_SESSION_ID" "status" "failed" || true
    state_update_session "$_CLAWDAD_DISPATCH_PROJECT_PATH" "$_CLAWDAD_DISPATCH_SESSION_ID" "last_response" "$completed_at" || true
    state_increment_session "$_CLAWDAD_DISPATCH_PROJECT_PATH" "$_CLAWDAD_DISPATCH_SESSION_ID" "dispatch_count" || true
    clawdad_log "dispatch abandoned: slug=$_CLAWDAD_DISPATCH_SLUG provider=$_CLAWDAD_DISPATCH_PROVIDER request_id=$_CLAWDAD_DISPATCH_REQUEST_ID exit=${exit_code:-1} error=$error_msg"
    return "$exit_code"
  }

  trap _dispatch_fail_unfinalized EXIT
  trap '_CLAWDAD_DISPATCH_ERROR="dispatch worker terminated"; _dispatch_fail_unfinalized; exit 143' TERM INT HUP

  local -a cmd
  _build_dispatch_command "$project_path" "$message" "$session_id" "$dispatch_count" "$provider" "$session_seeded" "$permission_mode" "$model" || {
    _CLAWDAD_DISPATCH_ERROR="failed to build dispatch command"
    return 1
  }

  # Run from project directory
  cd "$project_path" || {
    _CLAWDAD_DISPATCH_ERROR="Cannot cd to $project_path"
    clawdad_error "$_CLAWDAD_DISPATCH_ERROR"
    mailbox_update_status "$project_path" "failed" "$request_id" "" "Cannot cd to project directory" "$session_id"
    registry_update "$project_path" "status" "failed"
    return 1
  }

  # Keep Python bytecode/cache writes project-local. Delegated Codex turns often
  # run syntax checks such as `python -m py_compile`; without this, Python may
  # inherit a global pycache prefix outside the sandbox and fail unrelated work.
  export PYTHONPYCACHEPREFIX="${CLAWDAD_PYTHONPYCACHEPREFIX:-$project_path/.clawdad/pycache}"
  mkdir -p "$PYTHONPYCACHEPREFIX" 2>/dev/null || true

  local output exit_code output_file
  output_file=$(mktemp "${TMPDIR:-/tmp}/clawdad-dispatch.${request_id}.XXXXXX") || {
    _CLAWDAD_DISPATCH_ERROR="failed to create dispatch output file"
    return 1
  }
  "${cmd[@]}" >"$output_file" 2>&1 &
  _CLAWDAD_DISPATCH_CHILD_PID=$!
  (
    heartbeat_child_pid="$_CLAWDAD_DISPATCH_CHILD_PID"
    heartbeat_interval="${CLAWDAD_DISPATCH_HEARTBEAT_INTERVAL_SECONDS:-30}"
    if [[ ! "$heartbeat_interval" == <-> ]] || (( heartbeat_interval < 5 )); then
      heartbeat_interval=30
    fi
    while kill -0 "$heartbeat_child_pid" 2>/dev/null; do
      mailbox_update_heartbeat "$project_path" "$request_id" "$heartbeat_child_pid" "$session_id" >/dev/null 2>&1 || true
      sleep "$heartbeat_interval"
    done
  ) &
  _CLAWDAD_DISPATCH_HEARTBEAT_PID=$!
  if wait "$_CLAWDAD_DISPATCH_CHILD_PID"; then
    exit_code=0
  else
    exit_code=$?
  fi
  _CLAWDAD_DISPATCH_CHILD_PID=""
  if [[ -n "${_CLAWDAD_DISPATCH_HEARTBEAT_PID:-}" ]] && kill -0 "$_CLAWDAD_DISPATCH_HEARTBEAT_PID" 2>/dev/null; then
    kill -TERM "$_CLAWDAD_DISPATCH_HEARTBEAT_PID" 2>/dev/null || true
    wait "$_CLAWDAD_DISPATCH_HEARTBEAT_PID" 2>/dev/null || true
  fi
  _CLAWDAD_DISPATCH_HEARTBEAT_PID=""
  output=$(cat "$output_file" 2>/dev/null || true)
  rm -f "$output_file" 2>/dev/null || true

  local effective_session_id="$session_id"
  if [[ "$provider" == "codex" ]]; then
    local codex_session_id
    codex_session_id=$(_extract_codex_session_id "$output")
    if [[ -n "$codex_session_id" && "$codex_session_id" != "null" ]]; then
      effective_session_id="$codex_session_id"
      if [[ "$codex_session_id" != "$session_id" || "$session_seeded" != "true" ]]; then
        if registry_set_resume_session "$project_path" "$slug" "$provider" "$session_id" "$codex_session_id"; then
        else
          clawdad_log "dispatch warning: failed to persist Codex session id for $slug request_id=$request_id session=$codex_session_id"
        fi
      fi
    fi
  elif [[ "$provider" == "chimera" ]]; then
    local chimera_session_id
    chimera_session_id=$(_extract_chimera_session_id "$output")
    if [[ -n "$chimera_session_id" && "$chimera_session_id" != "null" ]]; then
      effective_session_id="$chimera_session_id"
      if [[ "$chimera_session_id" != "$session_id" || "$session_seeded" != "true" ]]; then
        if registry_set_resume_session "$project_path" "$slug" "$provider" "$session_id" "$chimera_session_id"; then
        else
          clawdad_log "dispatch warning: failed to persist Chimera session id for $slug request_id=$request_id session=$chimera_session_id"
        fi
      fi
    fi
  fi

  if (( exit_code == 0 )); then
    # Extract result using provider-specific parser
    local result_text
    case "$provider" in
      codex)  result_text=$(_extract_result_codex "$output") ;;
      chimera) result_text=$(_extract_result_chimera "$output") ;;
      *)      result_text="$output" ;;
    esac

    mailbox_write_response "$project_path" "$request_id" "$effective_session_id" "$exit_code" "$result_text"
    history_update_result "$project_path" "$request_id" "$effective_session_id" "$slug" "$provider" "answered" "$exit_code" "$(iso_timestamp)" "$result_text" || \
      clawdad_log "history warning: failed to write response record for $slug request_id=$request_id"
    mailbox_update_status "$project_path" "completed" "$request_id" "" "" "$effective_session_id"
    registry_update "$project_path" "status" "completed"
    registry_update "$project_path" "last_response" "$(iso_timestamp)"
    registry_increment "$project_path" "dispatch_count"
    state_update_session "$project_path" "$effective_session_id" "status" "completed"
    state_update_session "$project_path" "$effective_session_id" "last_response" "$(iso_timestamp)"
    state_increment_session "$project_path" "$effective_session_id" "dispatch_count"
    if [[ "$provider" == "codex" ]]; then
      _clear_codex_transport_failure "$project_path" "$effective_session_id"
    fi
    if [[ "$persist_active" == "true" ]]; then
      state_set_active_session "$project_path" "$effective_session_id"
    fi

    _CLAWDAD_DISPATCH_FINALIZED=true
    clawdad_log "dispatch completed: slug=$slug provider=$provider request_id=$request_id exit=$exit_code"
  else
    if mailbox_request_is_completed "$project_path" "$request_id"; then
      _CLAWDAD_DISPATCH_FINALIZED=true
      clawdad_log "dispatch failed child ignored after completed recovery: slug=$slug provider=$provider request_id=$request_id exit=$exit_code"
      return 0
    fi

    local error_msg
    case "$provider" in
      chimera)
        error_msg=$(_extract_chimera_error_text "$output")
        [[ -n "$error_msg" ]] || error_msg=$(echo "$output" | tail -5)
        ;;
      *)
        error_msg=$(echo "$output" | tail -5)
        ;;
    esac
    if [[ "$provider" == "codex" ]]; then
      local codex_error_text
      codex_error_text=$(_extract_codex_error_text "$output")
      if [[ -n "$codex_error_text" && "$codex_error_text" != "null" ]]; then
        error_msg="$codex_error_text"
      fi
    fi

    case "$provider" in
      chimera)
        mailbox_write_response "$project_path" "$request_id" "$effective_session_id" "$exit_code" "${error_msg:-$output}"
        ;;
      *)
        mailbox_write_response "$project_path" "$request_id" "$effective_session_id" "$exit_code" "$output"
        ;;
    esac
    history_update_result "$project_path" "$request_id" "$effective_session_id" "$slug" "$provider" "failed" "$exit_code" "$(iso_timestamp)" "${error_msg:-$output}" || \
      clawdad_log "history warning: failed to write failed response record for $slug request_id=$request_id"
    mailbox_update_status "$project_path" "failed" "$request_id" "" "$error_msg" "$effective_session_id"
    registry_update "$project_path" "status" "failed"
    registry_increment "$project_path" "dispatch_count"
    state_update_session "$project_path" "$effective_session_id" "status" "failed"
    state_update_session "$project_path" "$effective_session_id" "last_response" "$(iso_timestamp)"
    state_increment_session "$project_path" "$effective_session_id" "dispatch_count"
    if [[ "$provider" == "codex" ]] && _codex_error_is_transport_disconnect "${error_msg:-$output}"; then
      _record_codex_transport_failure "$project_path" "$effective_session_id" "${error_msg:-$output}"
    fi
    if [[ "$persist_active" == "true" ]]; then
      state_set_active_session "$project_path" "$effective_session_id"
    fi

    _CLAWDAD_DISPATCH_FINALIZED=true
    clawdad_log "dispatch failed: slug=$slug provider=$provider request_id=$request_id exit=$exit_code error=$error_msg"
  fi
}
