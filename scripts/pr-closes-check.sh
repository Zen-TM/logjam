#!/usr/bin/env bash
# The check .github/workflows/pr-closes.yml runs on every pull request: it
# closes an issue, or its body has a line `No issue: <why>`.
#
#   CLOSING=<issues GitHub will close> BODY=<PR body> pr-closes-check.sh
#   pr-closes-check.sh --self-test
#
# CLOSING comes from GitHub's closingIssuesReferences rather than a keyword
# regex here: it is what GitHub will actually close, so it counts `Closes:
# #N`, cross-repo references and a link made in the sidebar, and not a
# "fixes #12 later" in prose. `Part of #N` does not pass: that is the miss
# this check exists for. HTML comments are stripped first, so the template's
# hint cannot pass for an answer.
#
# Mutations the self-test catches: dropping the comment strip turns "No
# issue only inside a comment" red; dropping the non-empty reason turns
# "No issue with no reason" red.
set -uo pipefail

# check <closing count> <body>: exit 1 unless the PR closes an issue or says why not.
check() {
  local closing=$1 body=$2
  [ "${closing:-0}" -gt 0 ] && return 0
  printf '%s' "$body" | perl -0pe 's/<!--.*?-->//gs' \
    | grep -qiE '^[[:space:]]*No issue:[[:space:]]*[^[:space:]]' && return 0
  echo "::error::Add \`Closes #<issue>\` to the PR body, or a line \`No issue: <why>\`. \`Part of #<issue>\` leaves the issue open." >&2
  return 1
}

self_test() {
  local fails=0
  # case <description> <expected: pass|fail> <closing count> <body>
  case_() {
    local desc=$1 want=$2 got=fail
    check "$3" "$4" > /dev/null 2>&1 && got=pass
    if [ "$got" = "$want" ]; then echo "ok   — $desc"; else echo "FAIL — $desc: want $want, got $got"; fails=1; fi
  }
  local template=$'## What and why\n\nCloses #\n<!-- Or `No issue: <why>` when there is none. -->\n'

  case_ "closes an issue"                       pass 1 "Closes #12"
  case_ "unfilled template"                     fail 0 "$template"
  case_ "Part of an issue only"                 fail 0 $'Part of #341.'
  case_ "No issue with a reason"                pass 0 $'Closes #\n\nNo issue: a small docs fix.'
  case_ "No issue, any case, indented"          pass 0 $'  no issue: maintainer sign-off'
  case_ "No issue with no reason"               fail 0 $'No issue:   \n'
  case_ "No issue only inside a comment"        fail 0 $'<!--\nNo issue: hint\n-->'
  case_ "No issue mid-sentence"                 fail 0 "Closes: no issue; maintainer sign-off"
  case_ "empty body"                            fail 0 ""

  return "$fails"
}

case "${1:-}" in
  --self-test) self_test ;;
  "") check "${CLOSING:-0}" "${BODY:-}" ;;
  *) echo "usage: CLOSING=<n> BODY=<body> $0 | $0 --self-test" >&2; exit 2 ;;
esac
