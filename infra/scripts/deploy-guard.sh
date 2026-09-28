#!/usr/bin/env bash
# The two decisions .github/workflows/deploy-guard.yml makes before a deploy.
# Each writes `proceed=true|false|unknown` to $GITHUB_OUTPUT (stdout when
# unset); only `false` skips the deploy.
#
#   deploy-guard.sh fresh <sha>                 is <sha> still main's head?
#   deploy-guard.sh scope <target> <live> <sha> anything to deploy since <live>?
#   deploy-guard.sh --self-test
#
# Freshness FAILS CLOSED: when main's head cannot be read, skip. A stale run
# always has a newer one for main's head behind it (or already done), so a
# skip loses nothing that run does not ship, while deploying an old sha over a
# newer one does harm that nothing afterwards undoes.
#
# Scope FAILS OPEN: a deploy that runs when it did not need to costs a few
# minutes; one silently skipped leaves prod without a fix and tells nobody.
# Only a successfully computed "nothing changed" skips.
#
# Needs GH_TOKEN and REPO for the two gh api calls; --self-test needs neither.
set -uo pipefail

emit() {
  echo "proceed=$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "==> proceed=$1"
}

# decide_fresh <sha> <rc of the lookup> <main's head, or the error>
decide_fresh() {
  local sha=$1 rc=$2 main=$3
  if [ "$rc" != 0 ] || ! [[ "$main" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::warning title=Skipped, main unknown::could not read main's head, so not deploying $sha (a stale deploy would overwrite a newer one). Re-run this workflow once GitHub answers. Said: $main"
    emit false
  elif [ "$main" != "$sha" ]; then
    echo "::notice title=Skipped, stale::main is at $main, not $sha. The run for $main deploys this commit too once its CI is green; if main's CI is red, nothing deploys until it is fixed or re-run."
    emit false
  else
    emit true
  fi
}

# Paths whose change means the target must deploy. A change to the deploy
# machinery deploys too, so it runs once.
paths_for() {
  case "$1" in
    frontend) echo '^(frontend/|shared/|\.github/workflows/(deploy-frontend|deploy-guard|smoke|rollback)\.yml$|infra/scripts/(deploy-guard|frontend-prune)\.sh$)' ;;
    worker) echo '^(topo/|\.github/workflows/(deploy-topo-worker|deploy-guard|rollback)\.yml$|infra/scripts/(deploy-guard|pin-release|pin-ecs-task-image)\.sh$)' ;;
    *) return 1 ;;
  esac
}

# decide_scope <target> <live> <sha> <rc of the compare> <compare output:
# status on line 1, then one changed file per line>
decide_scope() {
  local target=$1 live=$2 sha=$3 rc=$4 out=$5 paths status files
  # The API rebuilds and deploys on every green push to main.
  if [ "$target" = api ]; then emit true; return; fi
  if ! paths=$(paths_for "$target"); then
    echo "::warning::unknown target '$target', deploying (fail open)"; emit unknown; return
  fi
  if [ -z "$live" ]; then
    echo "::warning::live release unknown, deploying (fail open)"; emit unknown; return
  fi
  if [ "$rc" != 0 ]; then
    echo "::warning::could not compare $live...$sha, deploying (fail open). API said: $out"
    emit unknown; return
  fi
  status=$(head -n1 <<<"$out")
  files=$(tail -n +2 <<<"$out")
  # identical: already live. ahead: a plain range to inspect. behind or
  # diverged (live is not an ancestor, say after a hand-made change): deploy
  # rather than reason about it.
  if [ "$status" = identical ]; then emit false; return; fi
  if [ "$status" != ahead ]; then
    echo "::warning::$live...$sha is '$status', deploying (fail open)"; emit unknown; return
  fi
  if [ -z "$files" ]; then
    echo "::warning::empty file list for $live...$sha, deploying (fail open)"; emit unknown; return
  fi
  echo "Files changed in $live...$sha:"
  sed 's/^/  /' <<<"$files"
  # The compare API lists at most 300 files; do not trust a negative answer
  # from a list that may be cut short.
  if [ "$(wc -l <<<"$files")" -ge 300 ]; then
    echo "::warning::300+ files, list may be truncated, deploying (fail open)"; emit unknown; return
  fi
  if grep -qE "$paths" <<<"$files"; then emit true; return; fi
  echo "::notice title=Skipped, nothing to deploy::nothing under $target's paths changed since the live release $live"
  emit false
}

self_test() {
  local fails=0 tmp got
  tmp=$(mktemp)
  # check <description> <expected> <function and args...>
  check() {
    local desc=$1 want=$2; shift 2
    : > "$tmp"
    GITHUB_OUTPUT=$tmp "$@" > /dev/null
    got=$(sed -n 's/^proceed=//p' "$tmp")
    if [ "$got" = "$want" ]; then echo "ok   — $desc"; else echo "FAIL — $desc: want $want, got '$got'"; fails=1; fi
  }
  local A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  local many
  many=$(printf 'ahead\n'; for i in $(seq 1 300); do echo "docs/f$i.md"; done)

  check "fresh: main is this sha"          true  decide_fresh "$A" 0 "$A"
  check "fresh: main moved on"             false decide_fresh "$A" 0 "$B"
  check "fresh: lookup failed"             false decide_fresh "$A" 1 "HTTP 502"
  check "fresh: lookup gave garbage"       false decide_fresh "$A" 0 ""
  check "scope: api always deploys"        true  decide_scope api "" "$A" 1 ""
  check "scope: live unknown"              unknown decide_scope frontend "" "$A" 0 ""
  check "scope: compare failed"            unknown decide_scope frontend "$B" "$A" 1 "HTTP 500"
  check "scope: identical"                 false decide_scope frontend "$A" "$A" 0 "identical"
  check "scope: diverged"                  unknown decide_scope frontend "$B" "$A" 0 $'diverged\ndocs/x.md'
  check "scope: behind"                    unknown decide_scope worker "$B" "$A" 0 $'behind\ntopo/x.py'
  check "scope: ahead, empty list"         unknown decide_scope frontend "$B" "$A" 0 "ahead"
  check "scope: ahead, 300+ files"         unknown decide_scope frontend "$B" "$A" 0 "$many"
  check "scope: frontend file"             true  decide_scope frontend "$B" "$A" 0 $'ahead\ndocs/x.md\nfrontend/src/a.ts'
  check "scope: shared file, frontend"     true  decide_scope frontend "$B" "$A" 0 $'ahead\nshared/src/a.ts'
  check "scope: docs only, frontend"       false decide_scope frontend "$B" "$A" 0 $'ahead\ndocs/x.md\napi/src/a.ts'
  check "scope: deploy machinery"          true  decide_scope frontend "$B" "$A" 0 $'ahead\n.github/workflows/smoke.yml'
  check "scope: topo file, worker"         true  decide_scope worker "$B" "$A" 0 $'ahead\ntopo/worker.py'
  check "scope: frontend file, worker"     false decide_scope worker "$B" "$A" 0 $'ahead\nfrontend/src/a.ts'
  check "scope: unknown target"            unknown decide_scope mobile "$B" "$A" 0 $'ahead\nmobile/a.ts'
  rm -f "$tmp"
  return $fails
}

case "${1:-}" in
  --self-test) self_test ;;
  fresh)
    MAIN=$(gh api "repos/$REPO/commits/main" --jq .sha 2>&1)
    decide_fresh "${2:?sha}" "$?" "$MAIN"
    ;;
  scope)
    OUT=$(gh api "repos/$REPO/compare/${3:-none}...${4:?sha}" --jq '.status, (.files[]?.filename)' 2>&1)
    decide_scope "${2:?target}" "$3" "$4" "$?" "$OUT"
    ;;
  *) echo "usage: $0 fresh <sha> | scope <target> <live> <sha> | --self-test" >&2; exit 2 ;;
esac
