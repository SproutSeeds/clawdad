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

_build_cmd_codex() {
  local message="$1" session_id="$2" dispatch_count="$3"
  local permission_mode="$4" model="$5"

  cmd=("$CLAWDAD_CODEX" "-q" "--prompt" "$message")

  # Codex uses --session for resume
  if (( dispatch_count > 0 )); then
    cmd+=("--session" "$session_id")
  fi

  # Map clawdad permission modes to codex approval modes
  case "$permission_mode" in
    plan)     cmd+=("--approval-mode" "suggest") ;;
    approve)  cmd+=("--approval-mode" "auto-edit") ;;
    full)     cmd+=("--approval-mode" "full-auto") ;;
    *)        cmd+=("--approval-mode" "suggest") ;;
  esac

  if [[ -n "$model" ]]; then
    cmd+=("--model" "$model")
  fi
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
  # Codex with -q outputs plain text
  echo "$output"
}

dispatch_to_spoke() {
  local project_path="$1" message="$2"
  local permission_mode="${3:-$CLAWDAD_PERMISSION_MODE}"
  local model="${4:-}"

  # Get project info from registry
  local session_id slug dispatch_count provider
  session_id=$(registry_field "$project_path" "session_id")
  slug=$(registry_field "$project_path" "slug")
  dispatch_count=$(registry_field "$project_path" "dispatch_count")
  provider=$(registry_field "$project_path" "provider")

  # Validate session_id
  if [[ -z "$session_id" || "$session_id" == "null" ]]; then
    clawdad_error "No session ID found for project. Register it first: clawdad register $project_path"
    return 1
  fi

  # Default provider if not set
  [[ -z "$provider" || "$provider" == "null" ]] && provider="$CLAWDAD_DEFAULT_PROVIDER"

  # Ensure local state exists for this project
  state_ensure_project "$project_path"

  # Default dispatch_count if empty or non-numeric
  [[ "$dispatch_count" =~ ^[0-9]+$ ]] || dispatch_count=0

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

  # Write request to mailbox
  mailbox_write_request "$project_path" "$request_id" "$message"
  mailbox_update_status "$project_path" "dispatched" "$request_id"
  registry_update "$project_path" "status" "dispatching"
  registry_update "$project_path" "last_dispatch" "$(iso_timestamp)"

  # Build provider-specific command
  local -a cmd
  case "$provider" in
    claude) _build_cmd_claude "$message" "$session_id" "$dispatch_count" "$permission_mode" "$model" ;;
    codex)  _build_cmd_codex "$message" "$session_id" "$dispatch_count" "$permission_mode" "$model" ;;
    *)
      clawdad_error "Unknown provider: $provider"
      return 1
      ;;
  esac

  # Launch background wrapper
  _dispatch_background "$project_path" "$request_id" "$session_id" "$slug" "$provider" "${cmd[@]}" &
  local bg_pid=$!

  mailbox_update_status "$project_path" "running" "$request_id" "$bg_pid"
  registry_update "$project_path" "status" "running"

  clawdad_info "Dispatched request $request_id to $slug via $provider (pid: $bg_pid)"
  clawdad_log "dispatch: slug=$slug provider=$provider request_id=$request_id pid=$bg_pid cmd=${cmd[*]}"
}

_dispatch_background() {
  local project_path="$1" request_id="$2" session_id="$3" slug="$4" provider="$5"
  shift 5
  local -a cmd=("$@")

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

  if (( exit_code == 0 )); then
    # Extract result using provider-specific parser
    local result_text
    case "$provider" in
      claude) result_text=$(_extract_result_claude "$output") ;;
      codex)  result_text=$(_extract_result_codex "$output") ;;
      *)      result_text="$output" ;;
    esac

    mailbox_write_response "$project_path" "$request_id" "$session_id" "$exit_code" "$result_text"
    mailbox_update_status "$project_path" "completed" "$request_id"
    registry_update "$project_path" "status" "completed"
    registry_update "$project_path" "last_response" "$(iso_timestamp)"
    registry_increment "$project_path" "dispatch_count"

    clawdad_log "dispatch completed: slug=$slug provider=$provider request_id=$request_id exit=$exit_code"
  else
    local error_msg
    error_msg=$(echo "$output" | tail -5)

    mailbox_write_response "$project_path" "$request_id" "$session_id" "$exit_code" "$output"
    mailbox_update_status "$project_path" "failed" "$request_id" "" "$error_msg"
    registry_update "$project_path" "status" "failed"
    registry_increment "$project_path" "dispatch_count"

    clawdad_log "dispatch failed: slug=$slug provider=$provider request_id=$request_id exit=$exit_code error=$error_msg"
  fi
}
