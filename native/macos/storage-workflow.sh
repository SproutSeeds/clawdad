#!/usr/bin/env zsh
# Shared lifecycle for this machine's native build/release scratch and cache lease.
# Other checkouts keep their existing environment unless the local service exists.
clawdad_storage_runner="${HOME}/.lifeops/bin/storage_maintenance.sh"
clawdad_storage_lease=""
clawdad_storage_temp=""

clawdad_storage_begin() {
  if [[ ! -x "$clawdad_storage_runner" ]]; then
    return 0
  fi
  if [[ ! -d /Volumes/Code_2TB/code || "$(stat -f %d /Volumes/Code_2TB)" == "$(stat -f %d /)" ]]; then
    print -u2 "The development drive is required for native build scratch."
    return 1
  fi
  local free_kib
  free_kib=$(df -k /System/Volumes/Data | awk 'NR == 2 {print $4}')
  if (( free_kib < 50 * 1024 * 1024 )); then
    print -u2 "Main has less than 50 GiB free; storage maintenance is required before a new build."
    return 1
  fi
  clawdad_storage_lease="clawdad-native-${$}-${RANDOM}"
  "$clawdad_storage_runner" hold "$clawdad_storage_lease" --reason "ClawDad native build or release workflow" >/dev/null
  mkdir -p /Volumes/Code_2TB/.agent-tmp/clawdad
  clawdad_storage_temp=$(mktemp -d /Volumes/Code_2TB/.agent-tmp/clawdad/native.XXXXXXXX)
  export TMPDIR="$clawdad_storage_temp/"
}

clawdad_storage_end() {
  local end_status=0
  if [[ -n "$clawdad_storage_temp" && "$clawdad_storage_temp" == /Volumes/Code_2TB/.agent-tmp/clawdad/native.* ]]; then
    rm -rf -- "$clawdad_storage_temp" || end_status=$?
  fi
  if [[ -n "$clawdad_storage_lease" ]]; then
    "$clawdad_storage_runner" release-hold "$clawdad_storage_lease" >/dev/null || end_status=$?
  fi
  return "$end_status"
}
