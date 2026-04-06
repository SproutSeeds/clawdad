#!/usr/bin/env zsh
# clawdad/lib/dispatch-worker.sh — Detached worker for a single dispatch
set -euo pipefail

_clawdad_self="${0:A}"
CLAWDAD_ROOT="${CLAWDAD_ROOT:-${_clawdad_self:h:h}}"

source "$CLAWDAD_ROOT/lib/common.sh"
source "$CLAWDAD_ROOT/lib/log.sh"
source "$CLAWDAD_ROOT/lib/registry.sh"
source "$CLAWDAD_ROOT/lib/mailbox.sh"
source "$CLAWDAD_ROOT/lib/history.sh"
source "$CLAWDAD_ROOT/lib/dispatch.sh"

_dispatch_background "$@"
