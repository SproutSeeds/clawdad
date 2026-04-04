#!/usr/bin/env zsh
# clawdad/lib/registry.sh — ORP-backed registry with local dispatch state
#
# ORP workspace tabs = source of truth for projects, sessions, providers
# ~/.clawdad/state.json  = local dispatch stats (counts, timestamps, status)

# --- Local state management (dispatch stats only) ---

_state_write() {
  local content="$1"
  local tmp="$CLAWDAD_STATE.tmp.$$"
  echo "$content" > "$tmp"
  mv "$tmp" "$CLAWDAD_STATE"
}

state_init() {
  mkdir -p "$CLAWDAD_HOME"
  if [[ ! -f "$CLAWDAD_STATE" ]]; then
    _state_write '{"version": 2, "orp_workspace": "'"$CLAWDAD_ORP_WORKSPACE"'", "projects": {}}'
    clawdad_log "Initialized state at $CLAWDAD_STATE"
  fi
}

state_ensure_project() {
  local project_path="$1"
  require_state

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
        registered_at: $ts
      }' "$CLAWDAD_STATE")
    _state_write "$updated"
  fi
}

state_update() {
  local project_path="$1" field="$2" value="$3"
  require_state

  local updated
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg field "$field" \
    --arg val "$value" \
    '.projects[$path][$field] = $val' "$CLAWDAD_STATE")
  _state_write "$updated"
}

state_increment() {
  local project_path="$1" field="$2"
  require_state

  local updated
  updated=$("$CLAWDAD_JQ" \
    --arg path "$project_path" \
    --arg field "$field" \
    '.projects[$path][$field] += 1' "$CLAWDAD_STATE")
  _state_write "$updated"
}

# --- ORP-backed registry operations ---

registry_init() {
  require_orp
  state_init
  clawdad_info "Initialized clawdad at $CLAWDAD_HOME (ORP workspace: $CLAWDAD_ORP_WORKSPACE)"
}

registry_add() {
  local project_path="$1" session_id="$2" slug="$3" description="${4:-}" provider="${5:-$CLAWDAD_DEFAULT_PROVIDER}"
  require_orp

  # Add tab to ORP workspace
  local -a orp_cmd
  orp_cmd=("$CLAWDAD_ORP" "workspace" "add-tab" "$CLAWDAD_ORP_WORKSPACE"
    "--path" "$project_path"
    "--title" "$slug"
    "--resume-tool" "$provider"
    "--resume-session-id" "$session_id"
    "--json")

  local result
  result=$("${orp_cmd[@]}" 2>&1)
  local exit_code=$?

  if (( exit_code != 0 )); then
    clawdad_error "Failed to add tab to ORP: $result"
    return 1
  fi

  local mutation
  mutation=$(echo "$result" | "$CLAWDAD_JQ" -r '.mutation // "unknown"' 2>/dev/null)

  # Initialize local dispatch state
  state_ensure_project "$project_path"

  clawdad_log "Registered project via ORP: $slug ($project_path) provider=$provider session=$session_id mutation=$mutation"
}

registry_remove() {
  local project_path="$1"
  require_orp

  local slug
  slug=$(orp_tab_field "$project_path" "title")

  "$CLAWDAD_ORP" workspace remove-tab "$CLAWDAD_ORP_WORKSPACE" \
    --path "$project_path" --json &>/dev/null

  # Clean up local state
  if [[ -f "$CLAWDAD_STATE" ]]; then
    local updated
    updated=$("$CLAWDAD_JQ" \
      --arg path "$project_path" \
      'del(.projects[$path])' "$CLAWDAD_STATE")
    _state_write "$updated"
  fi

  clawdad_log "Unregistered project via ORP: $slug ($project_path)"
}

# Get full tab info from ORP as JSON
registry_get() {
  local project_path="$1"
  _orp_tabs_json | "$CLAWDAD_JQ" \
    --arg path "$project_path" \
    '.tabs[] | select(.path == $path)'
}

# Unified field getter — checks ORP tab first, falls back to local state
registry_field() {
  local project_path="$1" field="$2"

  case "$field" in
    # Fields from ORP tabs
    session_id|resumeSessionId)
      orp_tab_field "$project_path" "resumeSessionId"
      ;;
    provider|resumeTool)
      local val
      val=$(orp_tab_field "$project_path" "resumeTool")
      echo "${val:-$CLAWDAD_DEFAULT_PROVIDER}"
      ;;
    slug|title)
      local val
      val=$(orp_tab_field "$project_path" "title")
      # Fallback to directory basename
      echo "${val:-${project_path:t}}"
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

registry_has_slug() {
  local slug="$1"
  local match
  match=$(_orp_tabs_json | "$CLAWDAD_JQ" -r \
    --arg title "$slug" \
    '.tabs[] | select(.title == $title) | .title' | head -1)
  [[ -n "$match" ]]
}
