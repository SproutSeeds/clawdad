#!/usr/bin/env zsh
# clawdad/lib/watch.sh — Polling watcher loop + tmux daemon mode

CLAWDAD_WATCH_SESSION="clawdad-watch"
CLAWDAD_WATCH_LOCK="$CLAWDAD_HOME/watch.lock"

watch_poll_once() {
  require_state

  # Find projects with "running" status in local state
  local running_projects
  running_projects=$("$CLAWDAD_JQ" -r \
    '.projects | to_entries[] | select(.value.status == "running") | .key' \
    "$CLAWDAD_STATE" 2>/dev/null)

  [[ -z "$running_projects" ]] && return 0

  local project_path
  while IFS= read -r project_path; do
    [[ -z "$project_path" ]] && continue

    local mbox_status
    mbox_status=$(mailbox_read_status "$project_path")
    local slug
    slug=$(registry_field "$project_path" "slug")

    case "$mbox_status" in
      completed)
        state_update "$project_path" "status" "completed"
        state_update "$project_path" "last_response" "$(iso_timestamp)"
        clawdad_info "[$slug] completed"
        ;;
      failed)
        state_update "$project_path" "status" "failed"
        clawdad_warn "[$slug] failed"
        ;;
      running)
        # Check if the PID is still alive
        local pid
        pid=$("$CLAWDAD_JQ" -r '.pid // 0' "$(mailbox_dir "$project_path")/status.json" 2>/dev/null || echo 0)
        [[ "$pid" =~ ^[0-9]+$ ]] || pid=0
        if (( pid > 0 )) && ! kill -0 "$pid" 2>/dev/null; then
          # Process died without updating status
          mailbox_update_status "$project_path" "failed" "" "" "Process $pid exited unexpectedly"
          state_update "$project_path" "status" "failed"
          clawdad_warn "[$slug] process $pid exited unexpectedly"
        fi
        ;;
    esac
  done <<< "$running_projects"
}

watch_loop() {
  local interval="${1:-$CLAWDAD_POLL_INTERVAL}"

  clawdad_info "Watching mailboxes (poll every ${interval}s) — Ctrl+C to stop"
  clawdad_log "Watch loop started, interval=${interval}s"

  while true; do
    watch_poll_once
    sleep "$interval"
  done
}

watch_daemon_start() {
  require_tmux

  # Check if already running
  if "$CLAWDAD_TMUX" has-session -t "$CLAWDAD_WATCH_SESSION" 2>/dev/null; then
    clawdad_info "Watch daemon already running in tmux session '$CLAWDAD_WATCH_SESSION'"
    return 0
  fi

  # mkdir-based lock (atomic on APFS)
  if ! mkdir "$CLAWDAD_WATCH_LOCK" 2>/dev/null; then
    # Check if the lock is stale
    if [[ -d "$CLAWDAD_WATCH_LOCK" ]]; then
      if ! "$CLAWDAD_TMUX" has-session -t "$CLAWDAD_WATCH_SESSION" 2>/dev/null; then
        rmdir "$CLAWDAD_WATCH_LOCK" 2>/dev/null
        mkdir "$CLAWDAD_WATCH_LOCK" || {
          clawdad_error "Cannot acquire watch lock"
          return 1
        }
      else
        clawdad_info "Watch daemon already running"
        return 0
      fi
    fi
  fi

  # Build the watch command
  local watch_cmd="source '$CLAWDAD_ROOT/lib/common.sh' && source '$CLAWDAD_ROOT/lib/log.sh' && source '$CLAWDAD_ROOT/lib/registry.sh' && source '$CLAWDAD_ROOT/lib/mailbox.sh' && source '$CLAWDAD_ROOT/lib/watch.sh' && watch_loop"

  if ! "$CLAWDAD_TMUX" new-session -d -s "$CLAWDAD_WATCH_SESSION" "$watch_cmd"; then
    rmdir "$CLAWDAD_WATCH_LOCK" 2>/dev/null
    clawdad_error "Failed to start watch daemon tmux session"
    return 1
  fi

  clawdad_info "Watch daemon started in tmux session '$CLAWDAD_WATCH_SESSION'"
  clawdad_log "Watch daemon started"
}

watch_daemon_stop() {
  require_tmux

  if "$CLAWDAD_TMUX" has-session -t "$CLAWDAD_WATCH_SESSION" 2>/dev/null; then
    "$CLAWDAD_TMUX" kill-session -t "$CLAWDAD_WATCH_SESSION"
    clawdad_info "Watch daemon stopped"
  else
    clawdad_info "Watch daemon not running"
  fi

  # Clean up lock
  rmdir "$CLAWDAD_WATCH_LOCK" 2>/dev/null
  clawdad_log "Watch daemon stopped"
}
