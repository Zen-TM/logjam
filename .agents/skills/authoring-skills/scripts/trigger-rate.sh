#!/usr/bin/env bash
# Usage: trigger-rate.sh <skill-name> <cases.tsv> [runs=3]
# cases.tsv: one case per line, "yes<TAB>request" (should load the skill) or
# "no<TAB>request" (a near-miss that should not). Run from the repo root.
# Each request goes to a fresh read-only `claude -p` session; a run counts as
# triggered when the session invokes the skill or reads its SKILL.md. Exits 2
# on an API error such as a rate limit.
set -euo pipefail
skill=$1 cases=$2 runs=${3:-3}
fails=0
printf 'expect\thits\trequest\n'
while IFS=$'\t' read -r expect request; do
  [ -z "$request" ] && continue
  hits=0
  for _ in $(seq "$runs"); do
    # Project settings only, so personal skills and plugins do not compete.
    out=$(claude -p "$request" --output-format stream-json --verbose --max-turns 4 \
      --setting-sources project --strict-mcp-config --no-session-persistence \
      --allowedTools "Read Grep Glob" --disallowedTools "Bash Edit Write" \
      </dev/null 2>&1) || true
    if grep -q '"api_error_status"' <<<"$out"; then
      # A rate limit is not a miss: stop rather than report a false rate.
      echo "API error: $(grep -o '"result":"[^"]*"' <<<"$out" | tail -1)" >&2
      exit 2
    fi
    if grep -qE "\"skill\":\"$skill\"|skills/$skill/SKILL\.md" <<<"$out"; then
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
