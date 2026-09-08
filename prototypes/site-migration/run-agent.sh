#!/usr/bin/env bash
#
# Run the migration agent in a scaffolded trial project, in the foreground.
#
# Foreground on purpose: a process this script backgrounds dies with it, which
# is how the first trial produced an empty log and no run. The caller keeps it
# alive.
#
# Usage: run-agent.sh <project-dir> [--resume]
set -euo pipefail

ROOT="${1:?usage: run-agent.sh <project-dir> [--resume]}"
MODE="${2:-}"

cd "$ROOT"

PROMPT_FILE=".shipstudio/trial-prompt.txt"
if [ "$MODE" = "--resume" ]; then
  PROMPT_FILE=".shipstudio/resume-prompt.txt"
fi

exec claude --print --permission-mode bypassPermissions "$(cat "$PROMPT_FILE")"
