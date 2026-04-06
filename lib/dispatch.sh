#!/usr/bin/env zsh
# clawdad/lib/dispatch.sh — Provider-agnostic dispatch to spoke agents

# Build the CLI command array for a given provider.
# Each provider function sets the `cmd` array variable in the caller's scope.
_build_cmd_claude() {
  local message="$1" session_id="$2" dispatch_count="$3"
  local permission_mode="$4" model="$5"

  cmd=("$CLAWDAD_CLAUDE" "-p" "$message")

  if (( dispatch_count == 0 )); then
    cmd+=("--session-id" "$session_id")
  else
    cmd+=("--resume" "$session_id")
  fi

  cmd+=("--output-format" "json")
  cmd+=("--permission-mode" "$permission_mode")

  if [[ -n "$model" ]]; then
    cmd+=("--model" "$model")
  fi
}

_claude_session_has_mailbox_history() {
  local project_path="$1" session_id="$2"
  local response_file
  response_file="$(mailbox_dir "$project_path")/response.md"

  [[ -f "$response_file" ]] || return 1
  rg -q "^Session: ${session_id}\$" "$response_file" 2>/dev/null
}

_build_cmd_codex() {
  local message="$1" session_id="$2" session_seeded="$3"
  local permission_mode="$4" model="$5" output_file="$6"

  local sandbox_mode="read-only"
  case "$permission_mode" in
    plan)    sandbox_mode="read-only" ;;
    approve) sandbox_mode="workspace-write" ;;
    full)    sandbox_mode="danger-full-access" ;;
    *)       sandbox_mode="workspace-write" ;;
  esac

  cmd=("$CLAWDAD_CODEX" "exec")
  if [[ "$session_seeded" == "true" && -n "$session_id" && "$session_id" != "null" ]]; then
    cmd+=("resume" "$session_id")
  fi

  cmd+=(
    "--json"
    "--output-last-message" "$output_file"
    "--skip-git-repo-check"
    "-c" 'approval_policy="never"'
    "-c" "sandbox_mode=\"$sandbox_mode\""
  )

  # In unattended workspace-write mode, opt Codex into networked local work.
  if [[ "$sandbox_mode" == "workspace-write" ]]; then
    cmd+=("-c" 'sandbox_workspace_write.network_access=true')
  fi

  if [[ -n "$model" ]]; then
    cmd+=("--model" "$model")
  fi

  cmd+=("$message")
}

_build_cmd_chimera() {
  local project_path="$1" message="$2" session_id="$3" session_seeded="$4"
  local permission_mode="$5" model="$6"

  cmd=(
    "$CLAWDAD_NODE"
    "$CLAWDAD_ROOT/lib/chimera-dispatch.mjs"
    "--project-path" "$project_path"
    "--message" "$message"
    "--session-id" "$session_id"
    "--permission-mode" "$permission_mode"
    "--chimera-binary" "$CLAWDAD_CHIMERA"
    "--home-dir" "$HOME"
  )

  if [[ "$session_seeded" == "true" ]]; then
    cmd+=("--session-seeded")
  fi

  if [[ -n "$model" ]]; then
    cmd+=("--model" "$model")
  fi
}

_build_dispatch_command() {
  local project_path="$1" message="$2" session_id="$3" dispatch_count="$4"
  local provider="$5" session_seeded="$6" permission_mode="$7" model="$8"

  cmd=()
  codex_output_file=""

  case "$provider" in
    claude)
      _build_cmd_claude "$message" "$session_id" "$dispatch_count" "$permission_mode" "$model"
      ;;
    codex)
      codex_output_file=$(mktemp "${TMPDIR:-/tmp}/clawdad-codex-last-message.XXXXXX")
      _build_cmd_codex "$message" "$session_id" "$session_seeded" "$permission_mode" "$model" "$codex_output_file"
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

# Extract the result text from provider-specific output
_extract_result_claude() {
  local output="$1"
  local result_text
  if ! result_text=$(echo "$output" | "$CLAWDAD_JQ" -r '
    if type == "array" then
      [.[] | select(.type == "result")] | last | .result // ""
    else
      .result // ""
    end
  ' 2>/dev/null); then
    result_text=""
  fi

  # Fallback: if jq parsing fails, use raw output
  if [[ -z "$result_text" || "$result_text" == "null" ]]; then
    echo "$output"
  else
    echo "$result_text"
  fi
}

_extract_result_codex() {
  local output="$1"
  # Codex exec writes JSONL progress to stdout; callers should prefer --output-last-message.
  echo "$output"
}

_extract_codex_thread_id() {
  local output="$1"
  echo "$output" | sed -n 's/.*"type":"thread.started".*"thread_id":"\([^"]*\)".*/\1/p' | head -1
}

_read_codex_last_message() {
  local output_file="$1" fallback="$2"

  if [[ -f "$output_file" ]]; then
    local content
    content=$(cat "$output_file")
    if [[ -n "$content" ]]; then
      echo "$content"
      return 0
    fi
  fi

  echo "$fallback"
}

_extract_result_chimera() {
  local output="$1"
  echo "$output" | "$CLAWDAD_JQ" -r '.result_text // ""' 2>/dev/null
}

_extract_chimera_session_id() {
  local output="$1"
  echo "$output" | "$CLAWDAD_JQ" -r '.session_id // ""' 2>/dev/null
}

_extract_chimera_error_text() {
  local output="$1"
  echo "$output" | "$CLAWDAD_JQ" -r '.error_text // ""' 2>/dev/null
}

dispatch_to_spoke() {
  local project_path="$1" message="$2"
  local permission_mode="${3:-$CLAWDAD_PERMISSION_MODE}"
  local model="${4:-}"

  # Resolve the active tracked session for this project bucket.
  local session_json
  session_json=$(registry_session_json "$project_path") || {
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
  if [[ "$provider" == "claude" && "$dispatch_count" == "0" ]] && _claude_session_has_mailbox_history "$project_path" "$session_id"; then
    dispatch_count=1
  fi

  # Validate provider is available
  require_provider "$provider"

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
  mailbox_update_status "$project_path" "dispatched" "$request_id"
  registry_update "$project_path" "status" "running"
  registry_update "$project_path" "last_dispatch" "$started_at"
  state_update_session "$project_path" "$session_id" "status" "running"
  state_update_session "$project_path" "$session_id" "last_dispatch" "$started_at"
  state_set_active_session "$project_path" "$session_id"

  local -a cmd
  local codex_output_file=""
  _build_dispatch_command "$project_path" "$message" "$session_id" "$dispatch_count" "$provider" "$session_seeded" "$permission_mode" "$model" || return 1

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
    "$message" >/dev/null 2>&1 </dev/null &
  local bg_pid=$!

  mailbox_update_status "$project_path" "running" "$request_id" "$bg_pid"

  clawdad_info "Dispatched request $request_id to $slug via $provider (pid: $bg_pid)"
  clawdad_log "dispatch: slug=$slug provider=$provider request_id=$request_id pid=$bg_pid cmd=${cmd[*]}"
}

_dispatch_background() {
  local project_path="$1" request_id="$2" session_id="$3" slug="$4" provider="$5"
  local session_seeded="${6:-}" dispatch_count="${7:-0}" permission_mode="${8:-$CLAWDAD_PERMISSION_MODE}"
  local model="${9:-}" message="${10:-}"

  local -a cmd
  local codex_output_file=""
  _build_dispatch_command "$project_path" "$message" "$session_id" "$dispatch_count" "$provider" "$session_seeded" "$permission_mode" "$model" || return 1

  # Run from project directory
  cd "$project_path" || {
    clawdad_error "Cannot cd to $project_path"
    mailbox_update_status "$project_path" "failed" "$request_id" "" "Cannot cd to project directory"
    registry_update "$project_path" "status" "failed"
    return 1
  }

  local output exit_code
  if output=$("${cmd[@]}" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  local effective_session_id="$session_id"
  if [[ "$provider" == "codex" ]]; then
    local codex_thread_id
    codex_thread_id=$(_extract_codex_thread_id "$output")
    if [[ -n "$codex_thread_id" && "$codex_thread_id" != "null" ]]; then
      effective_session_id="$codex_thread_id"
      if [[ "$codex_thread_id" != "$session_id" || "$session_seeded" != "true" ]]; then
        if registry_set_resume_session "$project_path" "$slug" "$provider" "$session_id" "$codex_thread_id"; then
        else
          clawdad_log "dispatch warning: failed to persist Codex session id for $slug request_id=$request_id session=$codex_thread_id"
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
      claude) result_text=$(_extract_result_claude "$output") ;;
      codex)  result_text=$(_read_codex_last_message "$codex_output_file" "$(_extract_result_codex "$output")") ;;
      chimera) result_text=$(_extract_result_chimera "$output") ;;
      *)      result_text="$output" ;;
    esac

    mailbox_write_response "$project_path" "$request_id" "$effective_session_id" "$exit_code" "$result_text"
    history_update_result "$project_path" "$request_id" "$effective_session_id" "$slug" "$provider" "answered" "$exit_code" "$(iso_timestamp)" "$result_text" || \
      clawdad_log "history warning: failed to write response record for $slug request_id=$request_id"
    mailbox_update_status "$project_path" "completed" "$request_id"
    registry_update "$project_path" "status" "completed"
    registry_update "$project_path" "last_response" "$(iso_timestamp)"
    registry_increment "$project_path" "dispatch_count"
    state_update_session "$project_path" "$effective_session_id" "status" "completed"
    state_update_session "$project_path" "$effective_session_id" "last_response" "$(iso_timestamp)"
    state_increment_session "$project_path" "$effective_session_id" "dispatch_count"
    state_set_active_session "$project_path" "$effective_session_id"

    clawdad_log "dispatch completed: slug=$slug provider=$provider request_id=$request_id exit=$exit_code"
  else
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
    mailbox_update_status "$project_path" "failed" "$request_id" "" "$error_msg"
    registry_update "$project_path" "status" "failed"
    registry_increment "$project_path" "dispatch_count"
    state_update_session "$project_path" "$effective_session_id" "status" "failed"
    state_update_session "$project_path" "$effective_session_id" "last_response" "$(iso_timestamp)"
    state_increment_session "$project_path" "$effective_session_id" "dispatch_count"
    state_set_active_session "$project_path" "$effective_session_id"

    clawdad_log "dispatch failed: slug=$slug provider=$provider request_id=$request_id exit=$exit_code error=$error_msg"
  fi

  if [[ -n "$codex_output_file" && -f "$codex_output_file" ]]; then
    rm -f "$codex_output_file"
  fi
}
