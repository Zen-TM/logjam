#!/usr/bin/env bash
# Which frontend bucket objects the deploy may delete (deploy-frontend.yml's
# prune step). Prints one key per line; deletes nothing itself.
#
# An object goes when it is older than the cutoff AND neither this release nor
# the live one (the rollback target if this deploy's smoke test fails) needs
# it. Age alone would not do: after a quiet month the live release's files are
# all past the cutoff.
#
# Usage:  frontend-prune.sh <listing.json> <this-files> <live-files> <sha> <live-sha> <cutoff>
#           listing.json: `aws s3api list-objects-v2 --output json`
#           *-files: the release's files.txt (every dist file but index.html)
#           cutoff: UTC, 2026-01-31T00:00:00
#         frontend-prune.sh --self-test
set -euo pipefail
# sort and comm must agree on one byte order, whatever the runner's locale.
export LC_ALL=C

prune_keys() {
  local listing=$1 this=$2 live=$3 sha=$4 live_sha=$5 cutoff=$6
  local keep
  keep=$(mktemp)
  {
    cat "$this" "$live"
    echo index.html
    for release in "$sha" "$live_sha"; do
      printf 'releases/%s/index.html\nreleases/%s/files.txt\n' "$release" "$release"
    done
  } | sort -u > "$keep"
  # LastModified comes as 2026-01-31T00:00:00+00:00 or ...000Z; both compare
  # correctly as strings against a cutoff with no zone suffix.
  jq -r --arg cutoff "$cutoff" '.Contents[]? | select(.LastModified < $cutoff) | .Key' "$listing" \
    | sort | comm -23 - "$keep"
  rm -f "$keep"
}

self_test() {
  local dir fails=0 got
  dir=$(mktemp -d)
  printf 'assets/new.js\nfavicon.ico\n' > "$dir/this.txt"
  printf 'assets/live.js\nfavicon.ico\nassets/Live Upper.js\n' > "$dir/live.txt"
  cat > "$dir/listing.json" <<'JSON'
{"Contents":[
  {"Key":"assets/new.js",              "LastModified":"2026-09-28T00:00:00+00:00"},
  {"Key":"assets/live.js",             "LastModified":"2026-07-01T00:00:00+00:00"},
  {"Key":"assets/Live Upper.js",       "LastModified":"2026-07-01T00:00:00.000Z"},
  {"Key":"assets/old.js",              "LastModified":"2026-07-01T00:00:00+00:00"},
  {"Key":"assets/old-z.js",            "LastModified":"2026-07-01T00:00:00.000Z"},
  {"Key":"assets/recent.js",           "LastModified":"2026-09-20T00:00:00+00:00"},
  {"Key":"assets/recent-z.js",         "LastModified":"2026-09-20T00:00:00.000Z"},
  {"Key":"index.html",                 "LastModified":"2026-07-01T00:00:00+00:00"},
  {"Key":"favicon.ico",                "LastModified":"2026-07-01T00:00:00+00:00"},
  {"Key":"releases/bbbb/index.html",   "LastModified":"2026-07-01T00:00:00+00:00"},
  {"Key":"releases/bbbb/files.txt",    "LastModified":"2026-07-01T00:00:00+00:00"},
  {"Key":"releases/cccc/index.html",   "LastModified":"2026-07-01T00:00:00+00:00"}
]}
JSON
  got=$(prune_keys "$dir/listing.json" "$dir/this.txt" "$dir/live.txt" aaaa bbbb 2026-08-29T00:00:00)
  check() { # check <description> <key> <kept|pruned>
    local is=kept
    grep -qxF "$2" <<<"$got" && is=pruned
    if [ "$is" = "$3" ]; then echo "ok   — $1"; else echo "FAIL — $1: $2 was $is"; fails=1; fi
  }
  check "old, in the live release: kept"         "assets/live.js" kept
  check "old, in the live release, Z time: kept" "assets/Live Upper.js" kept
  check "old live releases/ entry: kept"         "releases/bbbb/index.html" kept
  check "old live file list: kept"               "releases/bbbb/files.txt" kept
  check "old index.html: kept"                   "index.html" kept
  check "old, in this release: kept"             "favicon.ico" kept
  check "recent: kept"                           "assets/recent.js" kept
  check "recent, Z time: kept"                   "assets/recent-z.js" kept
  check "old, unreferenced: pruned"              "assets/old.js" pruned
  check "old, unreferenced, Z time: pruned"      "assets/old-z.js" pruned
  check "old other release: pruned"              "releases/cccc/index.html" pruned
  if [ "$(wc -l <<<"$got")" != 3 ]; then echo "FAIL — expected exactly 3 keys, got: $got"; fails=1; fi
  if [ -n "$(prune_keys <(echo '{}') "$dir/this.txt" "$dir/live.txt" aaaa bbbb 2026-08-29T00:00:00)" ]; then
    echo "FAIL — an empty bucket listed keys"; fails=1
  else
    echo "ok   — empty bucket: nothing"
  fi
  rm -rf "$dir"
  return $fails
}

case "${1:-}" in
  --self-test) self_test ;;
  *)
    [ $# = 6 ] || { echo "usage: $0 <listing.json> <this-files> <live-files> <sha> <live-sha> <cutoff> | --self-test" >&2; exit 2; }
    prune_keys "$@"
    ;;
esac
