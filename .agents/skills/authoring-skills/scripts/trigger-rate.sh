#!/usr/bin/env bash
# Usage: trigger-rate.sh [--harness claude|codex|agy] <skill-name> <cases.tsv> [runs=3]
# cases.tsv: one case per line, "yes<TAB>request" (should load the skill) or
# "no<TAB>request" (a near-miss that should not). Run from the repo root.
# Each request goes to a fresh read-only session of the chosen agent CLI
# (default claude); a run counts as triggered when the session invokes the
# skill or opens its SKILL.md. Exits 2 on an API error such as a rate limit.
set -euo pipefail
harness=claude
if [ "${1:-}" = --harness ]; then harness=$2; shift 2; fi
case "$harness" in claude|codex|agy) ;; *) echo "unknown harness: $harness" >&2; exit 64 ;; esac
skill=$1 cases=$2 runs=${3:-3}

# One read-only, non-persistent session; stdin closed so the CLI cannot eat
# the rest of the cases file.
run_session() {
  case "$harness" in
    # Project settings only, so personal skills and plugins do not compete.
    claude) claude -p "$1" --output-format stream-json --verbose --max-turns 4 \
              --setting-sources project --strict-mcp-config --no-session-persistence \
              --allowedTools "Read Grep Glob" --disallowedTools "Bash Edit Write" ;;
    codex)  codex exec --json --sandbox read-only --ephemeral "$1" ;;
    # agy -p keeps exploring after it has its answer; the cap bounds a run.
    agy)    agy -p "$1" --output-format stream-json --mode plan --print-timeout 180s ;;
  esac </dev/null 2>&1 || true
}

# Read the CLI's own error events, never free text: the files an agent reads
# while deciding can mention rate limits.
api_error() {
  case "$harness" in
    claude) grep -q '"api_error_status"' ;;
    codex)  jq -rR 'fromjson? | select(.type=="error" or .type=="turn.failed") | "x"' 2>/dev/null | grep -q x ;;
    # A run cut off by --print-timeout also ends in ERROR; only quota errors stop the script.
    agy)    jq -rR 'fromjson? | select(.event=="result" and .result.status=="ERROR") | .result.error' 2>/dev/null |
              grep -qiE 'RESOURCE_EXHAUSTED|429|quota|rate' ;;
  esac
}

# Codex and agy: match the path in what the agent asked for (its tool calls),
# not in tool output, where a directory listing can print it.
triggered() {
  case "$harness" in
    claude) grep -qE "\"skill\":\"$skill\"|skills/$skill/SKILL\.md" ;;
    codex)  jq -rR 'fromjson? | select(.type=="item.started") | .item.command? // empty' 2>/dev/null |
              grep -qF "skills/$skill/SKILL.md" ;;
    agy)    jq -rR 'fromjson? | .step_update.tool_info.parameters? // empty | tostring' 2>/dev/null |
              grep -qF "skills/$skill/SKILL.md" ;;
  esac
}

fails=0
printf 'harness: %s\nexpect\thits\trequest\n' "$harness"
while IFS=$'\t' read -r expect request; do
  [ -z "$request" ] && continue
  hits=0
  for _ in $(seq "$runs"); do
    out=$(run_session "$request")
    if api_error <<<"$out"; then
      # A rate limit is not a miss: stop rather than report a false rate.
      echo "API error ($harness): $(tail -c 300 <<<"$out")" >&2
      exit 2
    fi
    if triggered <<<"$out"; then
      hits=$((hits + 1))
    fi
  done
  printf '%s\t%s/%s\t%s\n' "$expect" "$hits" "$runs" "$request"
  if { [ "$expect" = yes ] && [ $((hits * 3)) -lt $((runs * 2)) ]; } ||
     { [ "$expect" = no ] && [ "$hits" -gt 0 ]; }; then
    fails=$((fails + 1))
  fi
done < "$cases"
echo "misses: $fails"
[ "$fails" -eq 0 ]
