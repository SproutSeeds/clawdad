#!/usr/bin/env zsh
# clawdad/lib/registry.sh — ORP-backed registry with local dispatch state
#
# ORP workspace tabs = source of truth for tracked sessions/providers
# ~/.clawdad/state.json  = local bucket + session state (active session, counts, timestamps)

# --- Local state management (dispatch stats only) ---

typeset -gi CLAWDAD_STATE_LOCK_DEPTH=0

_state_default_json() {
  printf '{"version": 3, "orp_workspace": "%s", "projects": {}}' "$CLAWDAD_ORP_WORKSPACE"
}

_state_lock_dir() {
  echo "$CLAWDAD_HOME/.state.lock"
}

_state_lock_owner_file() {
  echo "$(_state_lock_dir)/owner"
}

_state_lock_is_stale() {
  local owner_file owner_pid owner_started now lock_dir lock_started
  owner_file=$(_state_lock_owner_file)

  if [[ ! -f "$owner_file" ]]; then
    lock_dir=$(_state_lock_dir)
    [[ -d "$lock_dir" ]] || return 1
    lock_started=$(stat -f %m "$lock_dir" 2>/dev/null || echo "")
    now=$(date +%s)
    if [[ "$lock_started" =~ '^[0-9]+$' ]] && (( now - lock_started > 30 )); then
      return 0
    fi
    return 1
  fi

  IFS=' ' read -r owner_pid owner_started < "$owner_file" || return 0
  if [[ -z "$owner_pid" ]] || ! kill -0 "$owner_pid" 2>/dev/null; then
    return 0
  fi

  now=$(date +%s)
  if [[ "$owner_started" =~ '^[0-9]+$' ]] && (( now - owner_started > 30 )); then
    return 0
  fi

  return 1
}

_state_lock_clear_stale() {
  local lock_dir owner_file
  lock_dir=$(_state_lock_dir)
  owner_file=$(_state_lock_owner_file)
  rm -f "$owner_file" 2>/dev/null || true
  rmdir "$lock_dir" 2>/dev/null || rm -rf "$lock_dir" 2>/dev/null || true
}

_state_lock_acquire() {
  if (( CLAWDAD_STATE_LOCK_DEPTH > 0 )); then
    (( CLAWDAD_STATE_LOCK_DEPTH += 1 ))
    return 0
  fi
  CLAWDAD_STATE_LOCK_DEPTH=1
  return 0
}

_state_lock_release() {
  if (( CLAWDAD_STATE_LOCK_DEPTH <= 0 )); then
    return 0
  fi

  if (( CLAWDAD_STATE_LOCK_DEPTH > 1 )); then
    (( CLAWDAD_STATE_LOCK_DEPTH -= 1 ))
    return 0
  fi

  CLAWDAD_STATE_LOCK_DEPTH=0
  return 0
}

_state_is_valid_file() {
  [[ -f "$CLAWDAD_STATE" ]] && "$CLAWDAD_JQ" -e . "$CLAWDAD_STATE" >/dev/null 2>&1
}

_state_recover_if_invalid() {
  mkdir -p "$CLAWDAD_HOME"
  if _state_is_valid_file; then
    return 0
  fi

  if [[ -f "$CLAWDAD_STATE" ]]; then
    local backup_path
    backup_path="${CLAWDAD_STATE}.corrupt.$(date +%Y%m%dT%H%M%S).json"
    cp "$CLAWDAD_STATE" "$backup_path" 2>/dev/null || true
    clawdad_log "Recovered invalid state file at $CLAWDAD_STATE (backup: $backup_path)"
  fi

  _state_write "$(_state_default_json)"
}

_state_write() {
  local content="$1"
  if [[ -z "$content" ]]; then
    clawdad_error "Refusing to write empty state content to $CLAWDAD_STATE"
    return 1
  fi

  if ! printf '%s' "$content" | "$CLAWDAD_JQ" -e . >/dev/null 2>&1; then
    clawdad_error "Refusing to write invalid JSON state to $CLAWDAD_STATE"
    return 1
  fi

  mkdir -p "$CLAWDAD_HOME"
  local tmp
  tmp=$(mktemp "${CLAWDAD_STATE}.tmp.XXXXXX") || return 1
  printf '%s\n' "$content" > "$tmp"
  mv "$tmp" "$CLAWDAD_STATE"
}

_state_upgrade_schema() {
  require_state

  _state_lock_acquire || return 1
  local updated
  updated=$("$CLAWDAD_JQ" '
    .version = 3
    | .projects = (.projects // {})
    | .projects |= with_entries(
        .value |= (
          .status = (.status // "idle")
          | .last_dispatch = (.last_dispatch // null)
          | .last_response = (.last_response // null)
          | .dispatch_count = (.dispatch_count // 0)
          | .registered_at = (.registered_at // null)
          | .active_session_id = (.active_session_id // "")
          | .quarantined_sessions = (.quarantined_sessions // {})
          | .sessions = (.sessions // {})
          | .sessions |= with_entries(
              .value |= (
                .slug = (.slug // "")
                | .provider = (.provider // "")
                | .provider_override = (.provider_override // "")
                | .provider_session_seeded = (.provider_session_seeded // "true")
                | .local_only = (.local_only // "false")
                | .orp_error = (.orp_error // "")
                | .tracked_at = (.tracked_at // null)
                | .last_selected_at = (.last_selected_at // null)
                | .dispatch_count = (.dispatch_count // 0)
                | .last_dispatch = (.last_dispatch // null)
                | .last_response = (.last_response // null)
                | .status = (.status // "idle")
              )
            )
        )
      )
  ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_init() {
  mkdir -p "$CLAWDAD_HOME"
  if [[ ! -f "$CLAWDAD_STATE" ]]; then
    _state_write "$(_state_default_json)"
    clawdad_log "Initialized state at $CLAWDAD_STATE"
    return 0
  fi

  _state_recover_if_invalid || return 1
  _state_upgrade_schema
}

state_ensure_project() {
  local project_path="$1"
  state_init

  _state_lock_acquire || return 1
  local has_entry
  has_entry=$("$CLAWDAD_JQ" -e --arg path "$project_path" '.projects[$path]' "$CLAWDAD_STATE" 2>/dev/null) || true

  if [[ -z "$has_entry" || "$has_entry" == "null" ]]; then
    local updated
    updated=$("$CLAWDAD_JQ" \
      --arg path "$project_path" \
      --arg ts "$(iso_timestamp)" \
      '.projects[$path] = {
        status: "idle",
        last_dispatch: null,
        last_response: null,
        dispatch_count: 0,
        registered_at: $ts,
        active_session_id: "",
        quarantined_sessions: {},
        sessions: {}
      }' "$CLAWDAD_STATE")
    _state_write "$updated" || {
      _state_lock_release
      return 1
    }
  fi

  _state_lock_release
}

state_update() {
  local project_path="$1" field="$2" value="$3"
  state_init

  _state_lock_acquire || return 1
  local updated
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg field "$field" \
    --arg val "$value" \
    '.projects[$path][$field] = $val' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_increment() {
  local project_path="$1" field="$2"
  state_init

  _state_lock_acquire || return 1
  local updated
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg field "$field" \
    '.projects[$path][$field] += 1' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_register_session() {
  local project_path="$1" session_id="$2" slug="$3" provider="$4" session_seeded="${5:-true}"
  state_init
  _state_lock_acquire || return 1
  state_ensure_project "$project_path" || {
    _state_lock_release
    return 1
  }

  local updated ts
  ts="$(iso_timestamp)"
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg session "$session_id" \
    --arg slug "$slug" \
    --arg provider "$provider" \
    --arg seeded "$session_seeded" \
    --arg ts "$ts" '
      .projects[$path].sessions = (.projects[$path].sessions // {})
      | (.projects[$path].sessions[$session] // {}) as $prior
      | .projects[$path].sessions[$session] = (
          $prior
          | (if $provider == "codex" and (((.provider // "") == "chimera") or ((.provider_override // "") == "chimera")) then "chimera" else $provider end) as $effective_provider
          | $prior + {
              slug: $slug,
              provider: $effective_provider,
              provider_override: (if $provider == "chimera" or (($prior.provider_override // "") == "chimera") then "chimera" else ($prior.provider_override // "") end),
              provider_session_seeded: ($prior.provider_session_seeded // $seeded),
              tracked_at: ($prior.tracked_at // $ts),
              last_selected_at: ($prior.last_selected_at // null),
              dispatch_count: (($prior.dispatch_count // 0) | tonumber? // 0),
              last_dispatch: ($prior.last_dispatch // null),
              last_response: ($prior.last_response // null),
              status: ($prior.status // "idle"),
              local_only: ($prior.local_only // "false"),
              orp_error: ($prior.orp_error // "")
            }
        )
    ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_set_active_session() {
  local project_path="$1" session_id="$2"
  state_init
  _state_lock_acquire || return 1
  state_ensure_project "$project_path" || {
    _state_lock_release
    return 1
  }

  local updated ts
  ts="$(iso_timestamp)"
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg session "$session_id" \
    --arg ts "$ts" '
      .projects[$path].active_session_id = $session
      | .projects[$path].sessions = (.projects[$path].sessions // {})
      | if (.projects[$path].sessions[$session] // null) != null then
          .projects[$path].sessions[$session].last_selected_at = $ts
        else
          .
        end
    ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_session_field() {
  local project_path="$1" session_id="$2" field="$3"
  if [[ -f "$CLAWDAD_STATE" ]]; then
    "$CLAWDAD_JQ" -r \
      --arg path "$project_path" \
      --arg session "$session_id" \
      ".projects[\$path].sessions[\$session].$field // \"\"" "$CLAWDAD_STATE" 2>/dev/null
  fi
}

state_update_session() {
  local project_path="$1" session_id="$2" field="$3" value="$4"
  state_init
  _state_lock_acquire || return 1
  state_ensure_project "$project_path" || {
    _state_lock_release
    return 1
  }

  local updated
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg session "$session_id" \
    --arg field "$field" \
    --arg val "$value" '
      .projects[$path].sessions = (.projects[$path].sessions // {})
      | .projects[$path].sessions[$session] = (.projects[$path].sessions[$session] // {})
      | .projects[$path].sessions[$session][$field] = $val
    ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_quarantine_session() {
  local project_path="$1" session_id="$2" reason="${3:-quarantined}" detail="${4:-}"
  state_init
  _state_lock_acquire || return 1
  state_ensure_project "$project_path" || {
    _state_lock_release
    return 1
  }

  local updated ts
  ts="$(iso_timestamp)"
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg session "$session_id" \
    --arg reason "$reason" \
    --arg detail "$detail" \
    --arg ts "$ts" '
      .projects[$path].quarantined_sessions = (.projects[$path].quarantined_sessions // {})
      | (.projects[$path].sessions[$session] // .projects[$path].quarantined_sessions[$session] // {}) as $prior
      | .projects[$path].quarantined_sessions[$session] = (
          $prior + {
            slug: ($prior.slug // ""),
            provider: ($prior.provider // "codex"),
            status: ($prior.status // "failed"),
            dispatch_count: (($prior.dispatch_count // 0) | tonumber? // 0),
            last_dispatch: ($prior.last_dispatch // null),
            last_response: ($prior.last_response // null),
            reason: $reason,
            detail: $detail,
            quarantined_at: $ts
          }
        )
      | if (.projects[$path].sessions[$session] // null) != null then
          .projects[$path].sessions[$session].quarantined = "true"
          | .projects[$path].sessions[$session].quarantine_reason = $reason
          | .projects[$path].sessions[$session].quarantine_detail = $detail
          | .projects[$path].sessions[$session].quarantined_at = $ts
        else
          .
        end
    ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_session_is_quarantined() {
  local project_path="$1" session_id="$2"
  [[ -f "$CLAWDAD_STATE" ]] || return 1
  "$CLAWDAD_JQ" -e \
    --arg path "$project_path" \
    --arg session "$session_id" '
      ((.projects[$path].quarantined_sessions[$session] // null) != null)
      or ((.projects[$path].sessions[$session].quarantined // "false") == "true")
    ' "$CLAWDAD_STATE" >/dev/null 2>&1
}

state_session_quarantine_reason() {
  local project_path="$1" session_id="$2"
  if [[ -f "$CLAWDAD_STATE" ]]; then
    "$CLAWDAD_JQ" -r \
      --arg path "$project_path" \
      --arg session "$session_id" '
        .projects[$path].quarantined_sessions[$session].reason
        // .projects[$path].sessions[$session].quarantine_reason
        // "quarantined"
      ' "$CLAWDAD_STATE" 2>/dev/null
  fi
}

state_increment_session() {
  local project_path="$1" session_id="$2" field="$3"
  state_init
  _state_lock_acquire || return 1
  state_ensure_project "$project_path" || {
    _state_lock_release
    return 1
  }

  local updated
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg session "$session_id" \
    --arg field "$field" '
      .projects[$path].sessions = (.projects[$path].sessions // {})
      | .projects[$path].sessions[$session] = (.projects[$path].sessions[$session] // {})
      | .projects[$path].sessions[$session][$field] = (
          ((.projects[$path].sessions[$session][$field] // 0) | tonumber? // 0) + 1
        )
    ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

state_rekey_session() {
  local project_path="$1" old_session_id="$2" new_session_id="$3" slug="$4" provider="$5" session_seeded="${6:-true}"
  state_init
  _state_lock_acquire || return 1
  state_ensure_project "$project_path" || {
    _state_lock_release
    return 1
  }

  local updated ts
  ts="$(iso_timestamp)"
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg old "$old_session_id" \
    --arg new "$new_session_id" \
    --arg slug "$slug" \
    --arg provider "$provider" \
    --arg seeded "$session_seeded" \
    --arg ts "$ts" '
      .projects[$path].sessions = (.projects[$path].sessions // {})
      | (.projects[$path].sessions[$old] // .projects[$path].sessions[$new] // {}) as $prior
      | .projects[$path].sessions[$new] = (
          $prior
          + {
              slug: $slug,
              provider: $provider,
              provider_override: (if $provider == "chimera" or (($prior.provider_override // "") == "chimera") then "chimera" else ($prior.provider_override // "") end),
              provider_session_seeded: $seeded,
              tracked_at: ($prior.tracked_at // $ts),
              last_selected_at: ($prior.last_selected_at // null),
              dispatch_count: (($prior.dispatch_count // 0) | tonumber? // 0),
              last_dispatch: ($prior.last_dispatch // null),
              last_response: ($prior.last_response // null),
              status: ($prior.status // "idle"),
              local_only: ($prior.local_only // "false"),
              orp_error: ($prior.orp_error // "")
            }
        )
      | if $old != $new then
          .projects[$path].sessions |= del(.[$old])
        else
          .
        end
      | if .projects[$path].active_session_id == $old then
          .projects[$path].active_session_id = $new
        else
          .
        end
    ' "$CLAWDAD_STATE")
  local exit_code=$?
  if (( exit_code == 0 )); then
    _state_write "$updated" || exit_code=$?
  fi
  _state_lock_release
  return $exit_code
}

# --- ORP-backed registry operations ---

registry_init() {
  require_orp
  state_init
  clawdad_info "Initialized clawdad at $CLAWDAD_HOME (ORP workspace: $CLAWDAD_ORP_WORKSPACE)"
}

_registry_error_is_notes_limit() {
  local result="$1"
  [[ "$result" == *"Notes must"* && "$result" == *"10000"* ]]
}

_registry_default_session_seeded() {
  local provider="$1" session_seeded="${2:-}"
  if [[ -n "$session_seeded" ]]; then
    echo "$session_seeded"
    return 0
  fi

  if [[ "$provider" == "codex" || "$provider" == "chimera" ]]; then
    echo "false"
  else
    echo "true"
  fi
}

_registry_record_local_session() {
  local project_path="$1" session_id="$2" slug="$3" provider="$4" session_seeded="$5" orp_error="${6:-}"

  state_ensure_project "$project_path"
  state_register_session "$project_path" "$session_id" "$slug" "$provider" "$session_seeded"
  state_update_session "$project_path" "$session_id" "local_only" "true" >/dev/null 2>&1 || true
  if [[ -n "$orp_error" ]]; then
    state_update_session "$project_path" "$session_id" "orp_error" "$orp_error" >/dev/null 2>&1 || true
  fi
  state_set_active_session "$project_path" "$session_id"
}

_registry_rekey_local_session() {
  local project_path="$1" old_session_id="$2" new_session_id="$3" slug="$4" provider="$5" orp_error="${6:-}"

  state_rekey_session "$project_path" "$old_session_id" "$new_session_id" "$slug" "$provider" "true"
  state_update_session "$project_path" "$new_session_id" "local_only" "true" >/dev/null 2>&1 || true
  if [[ -n "$orp_error" ]]; then
    state_update_session "$project_path" "$new_session_id" "orp_error" "$orp_error" >/dev/null 2>&1 || true
  fi
  state_set_active_session "$project_path" "$new_session_id"
}

registry_add() {
  local project_path="$1" session_id="$2" slug="$3" description="${4:-}" provider="${5:-$CLAWDAD_DEFAULT_PROVIDER}"
  local session_seeded="${6:-}"
  local write_mode="${7:-append}"
  require_orp
  session_seeded=$(_registry_default_session_seeded "$provider" "$session_seeded")

  # Add tab to ORP workspace
  local -a orp_cmd
  orp_cmd=("$CLAWDAD_ORP" "workspace" "add-tab" "$CLAWDAD_ORP_WORKSPACE"
    "--path" "$project_path"
    "--title" "$slug"
    "--resume-tool" "$provider"
    "--resume-session-id" "$session_id"
    "--json")
  if [[ "$write_mode" != "update" ]]; then
    orp_cmd+=("--append")
  fi

  local result exit_code
  if result=$("${orp_cmd[@]}" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  if (( exit_code != 0 )); then
    if _registry_error_is_notes_limit "$result"; then
      _registry_record_local_session "$project_path" "$session_id" "$slug" "$provider" "$session_seeded" "$result"
      clawdad_warn "ORP workspace notes are at the 10000 character limit; registered local-only session '$slug' for $project_path"
      return 0
    fi
    clawdad_error "Failed to add tab to ORP: $result"
    return 1
  fi

  local mutation
  mutation=$(echo "$result" | "$CLAWDAD_JQ" -r '.mutation // "unknown"' 2>/dev/null)

  # Initialize local dispatch state
  state_ensure_project "$project_path"
  state_register_session "$project_path" "$session_id" "$slug" "$provider" "$session_seeded"
  state_update_session "$project_path" "$session_id" "local_only" "false" >/dev/null 2>&1 || true
  state_update_session "$project_path" "$session_id" "orp_error" "" >/dev/null 2>&1 || true
  state_set_active_session "$project_path" "$session_id"

  clawdad_log "Registered project via ORP: $slug ($project_path) provider=$provider session=$session_id mutation=$mutation"
}

registry_codex_tracked_session_ids_for_path() {
  local project_path="$1"
  _orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    '.tabs[]
      | select(.path == $path and (.resumeTool // "") == "codex" and (.resumeSessionId // "") != "")
      | .resumeSessionId'
  if [[ -f "$CLAWDAD_STATE" ]]; then
    "$CLAWDAD_JQ" -r \
      --arg path "$project_path" '
        (
          (.projects[$path].sessions // {})
          | to_entries[]?
          | select((.value.provider // "codex") == "codex")
          | .key
        ),
        (
          (.projects[$path].quarantined_sessions // {})
          | to_entries[]?
          | select((.value.provider // "codex") == "codex")
          | .key
        )
      ' "$CLAWDAD_STATE" 2>/dev/null
  fi
}

registry_list_saved_codex_sessions_json() {
  local project_path="$1" limit="${2:-0}"
  shift 2 || true

  require_node
  require_provider "codex"

  local -a cmd
  cmd=(
    "$CLAWDAD_NODE"
    "$CLAWDAD_ROOT/lib/codex-session-discovery.mjs"
    "--cwd" "$project_path"
    "--codex-home" "$CLAWDAD_CODEX_HOME"
    "--list"
    "--limit" "$limit"
  )

  local exclude
  for exclude in "$@"; do
    [[ -n "$exclude" ]] || continue
    cmd+=("--exclude" "$exclude")
  done

  "${cmd[@]}"
}

registry_find_saved_codex_session_json() {
  local project_path="$1"
  shift || true

  local sessions_json
  sessions_json=$(registry_list_saved_codex_sessions_json "$project_path" "1" "$@") || return 1
  echo "$sessions_json" | "$CLAWDAD_JQ" -c '
    if (.ok == true and ((.sessions // []) | length) > 0) then
      (.sessions[0] + { ok: true })
    else
      { ok: false, sessionId: "", reason: "not_found" }
    end
  '
}

registry_remove() {
  local project_path="$1" session_id="${2:-}" slug="${3:-}"
  require_orp

  local -a orp_cmd
  orp_cmd=("$CLAWDAD_ORP" "workspace" "remove-tab" "$CLAWDAD_ORP_WORKSPACE" "--path" "$project_path")
  if [[ -n "$session_id" ]]; then
    orp_cmd+=("--resume-session-id" "$session_id")
  else
    orp_cmd+=("--all")
  fi
  orp_cmd+=("--json")

  local remove_result remove_exit
  if remove_result=$("${orp_cmd[@]}" 2>&1); then
    remove_exit=0
  else
    remove_exit=$?
  fi
  if (( remove_exit != 0 )); then
    clawdad_warn "Failed to remove session from ORP workspace; removing local state only: $remove_result"
  fi

  # Clean up local state
  if [[ -f "$CLAWDAD_STATE" ]]; then
    local updated
    if [[ -n "$session_id" ]]; then
      updated=$("$CLAWDAD_JQ" \
        --arg path "$project_path" \
        --arg session "$session_id" '
          if (.projects[$path] // null) == null then
            .
          else
            .projects[$path].sessions |= del(.[$session])
            | if (((.projects[$path].sessions // {}) | length) == 0 and ((.projects[$path].quarantined_sessions // {}) | length) == 0) then
                .projects |= del(.[$path])
              elif .projects[$path].active_session_id == $session then
                .projects[$path].active_session_id = ""
              else
                .
              end
          end
        ' "$CLAWDAD_STATE")
    else
      updated=$("$CLAWDAD_JQ" \
        --arg path "$project_path" \
        'del(.projects[$path])' "$CLAWDAD_STATE")
    fi
    _state_write "$updated"
  fi

  clawdad_log "Unregistered project via ORP: $slug ($project_path)"
}

registry_set_resume_session() {
  local project_path="$1" slug="$2" provider="$3" old_session_id="$4" new_session_id="$5"
  require_orp
  local old_local_only
  old_local_only=$(state_session_field "$project_path" "$old_session_id" "local_only")

  local -a remove_cmd
  remove_cmd=("$CLAWDAD_ORP" "workspace" "remove-tab" "$CLAWDAD_ORP_WORKSPACE"
    "--path" "$project_path"
    "--resume-session-id" "$old_session_id"
    "--json")

  local result exit_code
  if result=$("${remove_cmd[@]}" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  if (( exit_code != 0 )); then
    if [[ "$old_local_only" == "true" ]] || _registry_error_is_notes_limit "$result"; then
      _registry_rekey_local_session "$project_path" "$old_session_id" "$new_session_id" "$slug" "$provider" "$result"
      clawdad_log "Updated local-only resume session: $slug ($project_path) provider=$provider session=$old_session_id->$new_session_id"
      return 0
    fi
    clawdad_error "Failed to replace ORP resume session (remove old tab): $result"
    return 1
  fi

  local -a orp_cmd
  orp_cmd=("$CLAWDAD_ORP" "workspace" "add-tab" "$CLAWDAD_ORP_WORKSPACE"
    "--path" "$project_path"
    "--title" "$slug"
    "--resume-tool" "$provider"
    "--resume-session-id" "$new_session_id"
    "--append"
    "--json")

  if result=$("${orp_cmd[@]}" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  if (( exit_code != 0 )); then
    if [[ "$old_local_only" == "true" ]] || _registry_error_is_notes_limit "$result"; then
      _registry_rekey_local_session "$project_path" "$old_session_id" "$new_session_id" "$slug" "$provider" "$result"
      clawdad_log "Converted resume session to local-only after ORP update failed: $slug ($project_path) provider=$provider session=$old_session_id->$new_session_id"
      return 0
    fi
    clawdad_error "Failed to update ORP resume session: $result"
    return 1
  fi

  state_rekey_session "$project_path" "$old_session_id" "$new_session_id" "$slug" "$provider" "true"
  state_update_session "$project_path" "$new_session_id" "local_only" "false" >/dev/null 2>&1 || true
  state_update_session "$project_path" "$new_session_id" "orp_error" "" >/dev/null 2>&1 || true
  clawdad_log "Updated ORP resume session: $slug ($project_path) provider=$provider session=$old_session_id->$new_session_id"
}

registry_rename_session() {
  local project_path="$1" selector="$2" new_slug="$3"
  require_orp

  new_slug="${new_slug#"${new_slug%%[![:space:]]*}"}"
  new_slug="${new_slug%"${new_slug##*[![:space:]]}"}"

  if [[ -z "$new_slug" ]]; then
    clawdad_error "Session title cannot be empty."
    return 1
  fi

  local session_json
  session_json=$(registry_session_json "$project_path" "$selector") || {
    clawdad_error "No tracked session '$selector' found for $project_path"
    return 1
  }

  local session_id old_slug provider result exit_code
  session_id=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.resumeSessionId // ""')
  old_slug=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.title // ""')
  provider=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.resumeTool // "codex"')
  local local_only
  local_only=$(echo "$session_json" | "$CLAWDAD_JQ" -r 'if (.localOnly // false) then "true" else "false" end')

  if [[ -z "$session_id" ]]; then
    clawdad_error "Session '$selector' has no resumable session id"
    return 1
  fi

  if registry_has_slug_in_project "$project_path" "$new_slug" "$session_id"; then
    clawdad_error "A session named '$new_slug' already exists in this project."
    return 1
  fi

  if [[ "$old_slug" == "$new_slug" ]]; then
    state_update_session "$project_path" "$session_id" "slug" "$new_slug" >/dev/null 2>&1 || true
    return 0
  fi

  if [[ "$local_only" == "true" ]]; then
    state_update_session "$project_path" "$session_id" "slug" "$new_slug" >/dev/null 2>&1 || true
    clawdad_log "Renamed local-only session: $old_slug -> $new_slug ($project_path, $session_id)"
    return 0
  fi

  local -a remove_cmd
  remove_cmd=("$CLAWDAD_ORP" "workspace" "remove-tab" "$CLAWDAD_ORP_WORKSPACE"
    "--path" "$project_path"
    "--resume-session-id" "$session_id"
    "--json")

  if result=$("${remove_cmd[@]}" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  if (( exit_code != 0 )); then
    if _registry_error_is_notes_limit "$result"; then
      state_update_session "$project_path" "$session_id" "slug" "$new_slug" >/dev/null 2>&1 || true
      state_update_session "$project_path" "$session_id" "local_only" "true" >/dev/null 2>&1 || true
      state_update_session "$project_path" "$session_id" "orp_error" "$result" >/dev/null 2>&1 || true
      clawdad_log "Renamed session locally after ORP remove failed: $old_slug -> $new_slug ($project_path, $session_id)"
      return 0
    fi
    clawdad_error "Failed to rename session in ORP (remove old tab): $result"
    return 1
  fi

  local -a add_cmd
  add_cmd=("$CLAWDAD_ORP" "workspace" "add-tab" "$CLAWDAD_ORP_WORKSPACE"
    "--path" "$project_path"
    "--title" "$new_slug"
    "--resume-tool" "$provider"
    "--resume-session-id" "$session_id"
    "--append"
    "--json")

  if result=$("${add_cmd[@]}" 2>&1); then
    exit_code=0
  else
    exit_code=$?
  fi

  if (( exit_code != 0 )); then
    local restore_result restore_code
    local -a restore_cmd
    restore_cmd=("$CLAWDAD_ORP" "workspace" "add-tab" "$CLAWDAD_ORP_WORKSPACE"
      "--path" "$project_path"
      "--title" "$old_slug"
      "--resume-tool" "$provider"
      "--resume-session-id" "$session_id"
      "--append"
      "--json")
    if restore_result=$("${restore_cmd[@]}" 2>&1); then
      restore_code=0
    else
      restore_code=$?
    fi

    if (( restore_code != 0 )); then
      if _registry_error_is_notes_limit "$result"; then
        state_update_session "$project_path" "$session_id" "slug" "$new_slug" >/dev/null 2>&1 || true
        state_update_session "$project_path" "$session_id" "local_only" "true" >/dev/null 2>&1 || true
        state_update_session "$project_path" "$session_id" "orp_error" "$result" >/dev/null 2>&1 || true
        clawdad_log "Renamed session locally after ORP add/restore failed: $old_slug -> $new_slug ($project_path, $session_id)"
        return 0
      fi
      clawdad_error "Failed to rename session and failed to restore original tab: $result // restore: $restore_result"
    else
      clawdad_error "Failed to rename session: $result"
    fi
    return 1
  fi

  state_update_session "$project_path" "$session_id" "slug" "$new_slug" >/dev/null 2>&1 || true
  clawdad_log "Renamed ORP session: $old_slug -> $new_slug ($project_path, $session_id)"
}

_registry_tabs_for_path_tsv() {
  local project_path="$1"
  _orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    '.tabs[]
      | select(
          .path == $path
          and (.resumeSessionId // "") != ""
          and (((.resumeTool // "codex") == "codex") or ((.resumeTool // "codex") == "chimera"))
        )
      | [(.resumeSessionId // ""), (.title // (.path | split("/") | last)), (.resumeTool // "codex")]
      | @tsv'
}

registry_session_exists() {
  local project_path="$1" session_id="$2"
  if state_session_is_quarantined "$project_path" "$session_id"; then
    return 1
  fi
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    --arg session "$session_id" \
    '.tabs[]
      | select(
          .path == $path
          and (.resumeSessionId // "") == $session
          and (((.resumeTool // "codex") == "codex") or ((.resumeTool // "codex") == "chimera"))
        )
      | .resumeSessionId' | head -1)
  if [[ -n "$match" ]]; then
    return 0
  fi

  if [[ -f "$CLAWDAD_STATE" ]]; then
    match=$("$CLAWDAD_JQ" -r \
      --arg path "$project_path" \
      --arg session "$session_id" \
      'if ((.projects[$path].sessions[$session] // null) != null) then $session else empty end' \
      "$CLAWDAD_STATE" 2>/dev/null | head -1)
    [[ -n "$match" ]] && return 0
  fi
  return 1
}

registry_has_slug_in_project() {
  local project_path="$1" slug="$2" exclude_session_id="${3:-}"
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    --arg title "$slug" \
    --arg exclude "$exclude_session_id" \
    --slurpfile state "$CLAWDAD_STATE" '
      ($state[0].projects[$path].sessions // {}) as $session_state
      | ($state[0].projects[$path].quarantined_sessions // {}) as $quarantined
      | .tabs[]
      | select(
          .path == $path
          and (.title // "") == $title
          and ($exclude == "" or (.resumeSessionId // "") != $exclude)
          and (($quarantined[.resumeSessionId] // null) == null)
          and (($session_state[.resumeSessionId].quarantined // "false") != "true")
        )
      | .title
    ' | head -1)
  if [[ -n "$match" ]]; then
    return 0
  fi

  if [[ -f "$CLAWDAD_STATE" ]]; then
    match=$("$CLAWDAD_JQ" -r \
      --arg path "$project_path" \
      --arg title "$slug" \
      --arg exclude "$exclude_session_id" '
        (.projects[$path].quarantined_sessions // {}) as $quarantined
        |
        (.projects[$path].sessions // {})
        | to_entries[]?
        | select(
            (.value.slug // "") == $title
            and ($exclude == "" or .key != $exclude)
            and (($quarantined[.key] // null) == null)
            and ((.value.quarantined // "false") != "true")
          )
        | .value.slug
      ' "$CLAWDAD_STATE" 2>/dev/null | head -1)
    [[ -n "$match" ]] && return 0
  fi
  return 1
}

_registry_default_session_id() {
  local project_path="$1"
  local base_slug="${project_path:t}"
  _orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    --arg base_slug "$base_slug" \
    --slurpfile state "$CLAWDAD_STATE" '
      ($state[0].projects[$path].sessions // {}) as $session_state
      | ($state[0].projects[$path].quarantined_sessions // {}) as $quarantined
      | [
          .tabs[]
          | select(
              .path == $path
              and (.resumeSessionId // "") != ""
              and (($quarantined[.resumeSessionId] // null) == null)
              and (($session_state[.resumeSessionId].quarantined // "false") != "true")
            )
        ] as $tabs
      | if ($tabs | length) == 0 then
          ""
        else
          (
            [
              ($tabs[] | select((.title // "") == $base_slug) | .resumeSessionId),
              ($tabs[0].resumeSessionId)
            ]
            | map(select(. != null and . != ""))
            | .[0]
          ) // ""
        end
    '
}

_registry_default_local_session_id() {
  local project_path="$1"
  [[ -f "$CLAWDAD_STATE" ]] || return 0

  "$CLAWDAD_JQ" -r \
    --arg path "$project_path" '
      (.projects[$path].active_session_id // "") as $active
      | (.projects[$path].quarantined_sessions // {}) as $quarantined
      | (.projects[$path].sessions // {}) as $sessions
      | if (
          $active != ""
          and (($sessions[$active] // null) != null)
          and (($quarantined[$active] // null) == null)
          and (($sessions[$active].quarantined // "false") != "true")
        ) then
          $active
        else
          (
            $sessions
            | to_entries
            | map(select((($quarantined[.key] // null) == null) and ((.value.quarantined // "false") != "true")))
            | .[0].key // ""
          )
        end
    ' "$CLAWDAD_STATE" 2>/dev/null
}

registry_local_session_json() {
  local project_path="$1" selector="${2:-}"
  [[ -f "$CLAWDAD_STATE" ]] || return 1

  local session_json
  session_json=$("$CLAWDAD_JQ" -c \
    --arg path "$project_path" \
    --arg selector "$selector" \
    --arg defaultProvider "$CLAWDAD_DEFAULT_PROVIDER" '
      (.projects[$path] // {}) as $project
      | ($project.sessions // {}) as $sessions
      | ($project.quarantined_sessions // {}) as $quarantined
      | (if $selector != "" then $selector else ($project.active_session_id // "") end) as $target
      | (
          [
            $sessions
            | to_entries[]?
            | select(
                (
                  ($target != "" and (.key == $target or (.value.slug // "") == $target))
                  or ($target == "" and .key == ($project.active_session_id // ""))
                )
                and (($quarantined[.key] // null) == null)
                and ((.value.quarantined // "false") != "true")
              )
          ][0]
        ) as $entry
      | if $entry == null then
          empty
        else
          (if ($entry.value.provider_override // "") != "" then $entry.value.provider_override elif ($entry.value.provider // "") == "" then $defaultProvider else $entry.value.provider end) as $provider
          | {
              title: ($entry.value.slug // ""),
              path: $path,
              resumeTool: $provider,
              resumeSessionId: $entry.key,
              localOnly: (($entry.value.local_only // "false") == "true"),
              providerSessionSeeded: (($entry.value.provider_session_seeded // "true") == "true")
            }
            + (if $provider == "codex" then { codexSessionId: $entry.key } else {} end)
            + (if $provider == "chimera" then { chimeraSessionId: $entry.key } else {} end)
        end
    ' "$CLAWDAD_STATE" 2>/dev/null || true)

  if [[ -n "$session_json" ]]; then
    echo "$session_json"
    return 0
  fi
  return 1
}

registry_sync_sessions_for_project() {
  local project_path="$1"
  state_ensure_project "$project_path"

  local lines
  lines=$(_registry_tabs_for_path_tsv "$project_path")
  if [[ -n "$lines" ]]; then
    while IFS=$'\t' read -r session_id slug provider; do
      [[ -n "$session_id" ]] || continue
      local existing_provider existing_provider_override
      existing_provider=$(state_session_field "$project_path" "$session_id" "provider")
      existing_provider_override=$(state_session_field "$project_path" "$session_id" "provider_override")
      if [[ "$provider" == "codex" && ( "$existing_provider" == "chimera" || "$existing_provider_override" == "chimera" ) ]]; then
        provider="chimera"
      fi
      local seeded
      seeded=$(state_session_field "$project_path" "$session_id" "provider_session_seeded")
      if [[ -z "$seeded" ]]; then
        seeded="true"
      fi
      state_register_session "$project_path" "$session_id" "$slug" "$provider" "$seeded"
      state_update_session "$project_path" "$session_id" "local_only" "false" >/dev/null 2>&1 || true
      state_update_session "$project_path" "$session_id" "orp_error" "" >/dev/null 2>&1 || true
    done <<< "$lines"
  fi

  local active_session
  active_session=$(state_field "$project_path" "active_session_id")
  if [[ -z "$active_session" || "$active_session" == "null" ]] || ! registry_session_exists "$project_path" "$active_session"; then
    local fallback
    fallback=$(_registry_default_session_id "$project_path")
    if [[ -z "$fallback" ]]; then
      fallback=$(_registry_default_local_session_id "$project_path")
    fi
    if [[ -n "$fallback" ]]; then
      state_set_active_session "$project_path" "$fallback"
    fi
  fi
}

registry_active_session_id() {
  local project_path="$1"
  registry_sync_sessions_for_project "$project_path" >/dev/null
  local active_session
  active_session=$(state_field "$project_path" "active_session_id")
  if [[ -n "$active_session" && "$active_session" != "null" ]] && registry_session_exists "$project_path" "$active_session"; then
    echo "$active_session"
    return 0
  fi
  local fallback
  fallback=$(_registry_default_session_id "$project_path")
  if [[ -z "$fallback" ]]; then
    fallback=$(_registry_default_local_session_id "$project_path")
  fi
  echo "$fallback"
}

registry_session_json() {
  local project_path="$1" selector="${2:-}"
  registry_sync_sessions_for_project "$project_path" >/dev/null

  if [[ -z "$selector" ]]; then
    selector=$(registry_active_session_id "$project_path")
  fi

  if [[ -z "$selector" ]]; then
    return 1
  fi

  # ORP currently normalizes some non-Codex resume tabs back to codex. When
  # local state knows the selected session is Chimera-backed, trust that local
  # provider metadata so Clawdad dispatches through the Chimera lane.
  local local_session_json local_provider
  local_session_json=$(registry_local_session_json "$project_path" "$selector" 2>/dev/null || true)
  if [[ -n "$local_session_json" ]]; then
    local_provider=$(echo "$local_session_json" | "$CLAWDAD_JQ" -r '.resumeTool // ""' 2>/dev/null || true)
    if [[ "$local_provider" == "chimera" ]]; then
      echo "$local_session_json"
      return 0
    fi
  fi

  local session_json
  session_json=$(_orp_tabs_json | "$CLAWDAD_JQ" -c \
    --arg path "$project_path" \
    --arg selector "$selector" \
    --slurpfile state "$CLAWDAD_STATE" '
      ($state[0].projects[$path].sessions // {}) as $session_state
      | ($state[0].projects[$path].quarantined_sessions // {}) as $quarantined
      |
      [
        .tabs[]
        | select(
            .path == $path
            and (((.resumeTool // "codex") == "codex") or ((.resumeTool // "codex") == "chimera"))
            and (($quarantined[.resumeSessionId] // null) == null)
            and (($session_state[.resumeSessionId].quarantined // "false") != "true")
          )
      ] as $tabs
      | (
          [ $tabs[] | select((.resumeSessionId // "") == $selector or (.title // "") == $selector) ]
          | .[0]
        ) // empty
    ' 2>/dev/null || true)

  if [[ -n "$session_json" ]]; then
    echo "$session_json"
    return 0
  fi

  registry_local_session_json "$project_path" "$selector"
}

registry_session_field() {
  local project_path="$1" selector="${2:-}" field="$3"
  local session_json
  session_json=$(registry_session_json "$project_path" "$selector") || return 1
  echo "$session_json" | "$CLAWDAD_JQ" -r ".$field // \"\""
}

registry_list_sessions_json() {
  local project_path="$1"
  registry_sync_sessions_for_project "$project_path" >/dev/null

  local active_session
  active_session=$(registry_active_session_id "$project_path")

  _orp_tabs_json | "$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg active "$active_session" \
    --arg defaultProvider "$CLAWDAD_DEFAULT_PROVIDER" \
    --slurpfile state "$CLAWDAD_STATE" '
      ($state[0].projects[$path].sessions // {}) as $session_state
      | ($state[0].projects[$path].quarantined_sessions // {}) as $quarantined
      | (
          [
            .tabs[]
            | select(
                .path == $path
                and (.resumeSessionId // "") != ""
                and (((.resumeTool // "codex") == "codex") or ((.resumeTool // "codex") == "chimera"))
                and (($quarantined[.resumeSessionId] // null) == null)
                and (($session_state[.resumeSessionId].quarantined // "false") != "true")
              )
            | . as $tab
            | (if (($session_state[$tab.resumeSessionId].provider_override // "") != "") then ($session_state[$tab.resumeSessionId].provider_override // "") elif (($tab.resumeTool // "codex") == "codex" and (($session_state[$tab.resumeSessionId].provider // "") == "chimera")) then "chimera" else ($tab.resumeTool // "codex") end) as $provider
            | {
                slug: ($tab.title // ($tab.path | split("/") | last)),
                path: $tab.path,
                provider: $provider,
                sessionId: ($tab.resumeSessionId // null),
                active: (($tab.resumeSessionId // "") == $active),
                status: ($session_state[$tab.resumeSessionId].status // "idle"),
                dispatchCount: (($session_state[$tab.resumeSessionId].dispatch_count // 0) | tonumber? // 0),
                lastDispatch: ($session_state[$tab.resumeSessionId].last_dispatch // null),
                lastResponse: ($session_state[$tab.resumeSessionId].last_response // null),
                providerSessionSeeded: (($session_state[$tab.resumeSessionId].provider_session_seeded // "true") == "true"),
                localOnly: false
              }
          ]
        ) as $orp_sessions
      | ($orp_sessions | map(.sessionId)) as $orp_session_ids
      | (
          [
            $session_state
            | to_entries[]?
            | . as $entry
            | select(($orp_session_ids | index($entry.key)) == null)
            | select(($quarantined[$entry.key] // null) == null)
            | select(($entry.value.quarantined // "false") != "true")
            | (if ($entry.value.provider_override // "") != "" then $entry.value.provider_override elif ($entry.value.provider // "") == "" then $defaultProvider else $entry.value.provider end) as $provider
            | {
                slug: ($entry.value.slug // ""),
                path: $path,
                provider: $provider,
                sessionId: $entry.key,
                active: ($entry.key == $active),
                status: ($entry.value.status // "idle"),
                dispatchCount: (($entry.value.dispatch_count // 0) | tonumber? // 0),
                lastDispatch: ($entry.value.last_dispatch // null),
                lastResponse: ($entry.value.last_response // null),
                providerSessionSeeded: (($entry.value.provider_session_seeded // "true") == "true"),
                localOnly: (($entry.value.local_only // "false") == "true")
              }
          ]
        ) as $local_sessions
      | $orp_sessions + $local_sessions
    '
}

registry_session_count() {
  local project_path="$1"
  registry_list_sessions_json "$project_path" | "$CLAWDAD_JQ" 'length'
}

registry_select_session() {
  local project_path="$1" selector="$2"
  local session_json
  session_json=$(registry_session_json "$project_path" "$selector") || {
    clawdad_error "No tracked session '$selector' found for $project_path"
    return 1
  }

  local session_id
  session_id=$(echo "$session_json" | "$CLAWDAD_JQ" -r '.resumeSessionId // ""')
  if [[ -z "$session_id" ]]; then
    clawdad_error "Session '$selector' has no resumable session id"
    return 1
  fi

  state_set_active_session "$project_path" "$session_id"
  echo "$session_id"
}

# Get full tab info from ORP as JSON
registry_get() {
  local project_path="$1"
  registry_session_json "$project_path"
}

# Unified field getter — checks ORP tab first, falls back to local state
registry_field() {
  local project_path="$1" field="$2"

  case "$field" in
    # Fields from ORP tabs
    session_id|resumeSessionId)
      registry_active_session_id "$project_path"
      ;;
    provider|resumeTool)
      local val
      val=$(registry_session_field "$project_path" "" "resumeTool")
      echo "${val:-$CLAWDAD_DEFAULT_PROVIDER}"
      ;;
    slug|title)
      local val
      val=$(registry_session_field "$project_path" "" "title")
      # Fallback to directory basename
      echo "${val:-${project_path:t}}"
      ;;
    active_session_id)
      registry_active_session_id "$project_path"
      ;;
    # Fields from local state
    status|last_dispatch|last_response|dispatch_count|registered_at)
      state_field "$project_path" "$field"
      ;;
    *)
      # Try ORP first, then state
      local val
      val=$(orp_tab_field "$project_path" "$field")
      if [[ -z "$val" || "$val" == "null" ]]; then
        val=$(state_field "$project_path" "$field")
      fi
      echo "$val"
      ;;
  esac
}

# Convenience aliases that map to state_update/state_increment
registry_update() {
  state_update "$@"
}

registry_increment() {
  state_increment "$@"
}

registry_list() {
  local tabs_json
  tabs_json=$(_orp_tabs_json) || return 1

  echo "$tabs_json" | "$CLAWDAD_JQ" -r '.tabs[] | "\(.title // (.path | split("/") | last))\t\(.path)\t\(.resumeTool // "none")"'
}

registry_has_path() {
  local project_path="$1"
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    '.tabs[] | select(.path == $path) | .path' | head -1)
  [[ -n "$match" ]]
}

registry_has_tracked_session_for_path() {
  local project_path="$1"
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    '.tabs[]
      | select(
          .path == $path
          and (.resumeSessionId // "") != ""
          and (((.resumeTool // "codex") == "codex") or ((.resumeTool // "codex") == "chimera"))
        )
      | .resumeSessionId' | head -1)
  if [[ -n "$match" ]]; then
    return 0
  fi

  if [[ -f "$CLAWDAD_STATE" ]]; then
    match=$("$CLAWDAD_JQ" -r \
      --arg path "$project_path" '
        (.projects[$path].sessions // {})
        | to_entries[]?
        | select((.value.provider // "") == "codex" or (.value.provider // "") == "chimera")
        | .key
      ' "$CLAWDAD_STATE" 2>/dev/null | head -1)
    [[ -n "$match" ]] && return 0
  fi
  return 1
}

registry_has_slug() {
  local slug="$1"
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg title "$slug" \
    '.tabs[] | select(.title == $title) | .title' | head -1)
  if [[ -n "$match" ]]; then
    return 0
  fi

  if [[ -f "$CLAWDAD_STATE" ]]; then
    match=$("$CLAWDAD_JQ" -r \
      --arg title "$slug" '
        (.projects // {})
        | to_entries[]?
        | (.value.sessions // {})
        | to_entries[]?
        | select((.value.slug // "") == $title)
        | .value.slug
      ' "$CLAWDAD_STATE" 2>/dev/null | head -1)
    [[ -n "$match" ]] && return 0
  fi
  return 1
}

registry_has_untracked_slug_for_path() {
  local project_path="$1" slug="$2"
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg path "$project_path" \
    --arg title "$slug" \
    '.tabs[]
      | select(
          .path == $path
          and (.title // "") == $title
          and (.resumeSessionId // "") == ""
        )
      | .title' | head -1)
  [[ -n "$match" ]]
}
