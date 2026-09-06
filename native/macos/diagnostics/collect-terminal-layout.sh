#!/bin/zsh
set -eu
diagnostic_dir=${0:A:h}
diagnostic_repo=${diagnostic_dir:h:h:h}
diagnostic_output="$diagnostic_repo/.clawdad/diagnostics/terminal-layout"
mkdir -p "$diagnostic_output"
diagnostic_report="$diagnostic_output/$(date -u +%Y%m%dT%H%M%SZ).json"
/usr/bin/osascript -l JavaScript "$diagnostic_dir/terminal-layout.js" > "$diagnostic_report"
xcrun swift "$diagnostic_dir/terminal-accessibility.swift" > "$diagnostic_report.accessibility.json"
print -r -- "Saved Terminal metadata to $diagnostic_report"
print -r -- "Saved native tab metadata beside the scripting report."
