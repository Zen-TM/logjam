#!/usr/bin/env bash
# Print the brain's release pointer, the release.json deploy-api.yml and
# rollback.yml write to the signals bucket: {"sha": "...", "env": {...}} with
# the sha and every KEY=value line of an env file (default infra/brain/api.env)
# as strings. The brain's release agent (infra/brain/host/release-agent.sh)
# refuses a pointer whose sha, key or value fails its checks and keeps the old
# release, so this script applies the same checks here and fails the run
# instead.
#
#   brain-release.sh <sha> [env-file]
#   brain-release.sh --self-test
#
# Callers write the output to a file before uploading it: piped straight into
# `aws s3 cp -`, a failure here would still upload an empty pointer.
#
# The checks are the agent's three patterns, copied. --self-test fails when
# either file stops containing the other's. Mutations that turn it red: dropping
# the single quote or the backslash from the value pattern here fails "a value
# with a single quote" or "a value with a backslash" and the shared-pattern
# check; loosening the key pattern in release-agent.sh alone fails the
# shared-pattern check.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pointer() {
  python3 - "$@" <<'PY'
import json, re, sys

sha, path = sys.argv[1], sys.argv[2]
if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", sha):
    sys.exit("brain-release: bad sha")
env = {}
with open(path) as f:
    for n, line in enumerate(f, 1):
        line = line.rstrip("\n")
        if not line.strip() or line.startswith("#"):
            continue
        k, eq, v = line.partition("=")
        where = f"{path}:{n}"
        if not eq:
            sys.exit(f"brain-release: {where}: not KEY=value")
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", k):
            sys.exit(f"brain-release: {where}: bad name")
        if re.search(r"[\x00-\x1f\x7f'\\]", v):
            sys.exit(f"brain-release: {where}: the release agent refuses a value with a control character, a single quote or a backslash ({k})")
        if k in env:
            sys.exit(f"brain-release: {where}: {k} is set twice")
        env[k] = v
print(json.dumps({"sha": sha, "env": env}))
PY
}

self_test() {
  local fails=0 dir out
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' RETURN
  local A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  # check <description> <expected: ok or fail> <sha> <file content>
  check() {
    local desc=$1 want=$2 sha=$3 got=ok
    printf '%s' "$4" > "$dir/env"
    out=$(pointer "$sha" "$dir/env" 2>&1) || got=fail
    if [ "$got" = "$want" ]; then echo "ok   — $desc"; else echo "FAIL — $desc: want $want, got $got: $out"; fails=1; fi
  }
  check "a good file"                      ok   "$A" $'A=1\nB_2=https://x.example/a=b\n'
  check "a comment and a blank line"       ok   "$A" $'# note\n\nA=1\n'
  check "an empty value"                   ok   "$A" $'A=\n'
  check "a value with a single quote"      fail "$A" $'A=it\'s\n'
  check "a bad key"                        fail "$A" $'a=1\n'
  check "a key that starts with a digit"   fail "$A" $'1A=1\n'
  check "a line without ="                 fail "$A" $'A\n'
  check "a value with a backslash"         fail "$A" $'A=a\\b\n'
  check "a control character in a value"   fail "$A" $'A=a\tb\n'
  check "a key set twice"                  fail "$A" $'A=1\nA=2\n'
  check "a bad sha"                        fail "not a sha!" $'A=1\n'
  check "an empty sha"                     fail "" $'A=1\n'

  # What a good file becomes: strings only, in order, the sha as given.
  printf 'A=1\nB=x=y\n' > "$dir/env"
  out=$(pointer "$A" "$dir/env" | python3 -c 'import json,sys; p=json.load(sys.stdin); print(p["sha"]==sys.argv[1], list(p["env"].items()))' "$A")
  if [ "$out" = "True [('A', '1'), ('B', 'x=y')]" ]; then echo "ok   — the pointer's shape"; else echo "FAIL — the pointer's shape: $out"; fails=1; fi

  # The committed file passes.
  if out=$(pointer "$A" "$HERE/../brain/api.env" 2>&1); then echo "ok   — infra/brain/api.env passes"; else echo "FAIL — infra/brain/api.env: $out"; fails=1; fi

  # The agent's patterns are these patterns.
  local p
  for p in '[A-Za-z0-9][A-Za-z0-9_.-]{0,127}' '[A-Z][A-Z0-9_]*' "[\\x00-\\x1f\\x7f'\\\\]"; do
    if grep -qF "\"$p\"" "$HERE/../brain/host/release-agent.sh" && grep -qF "\"$p\"" "${BASH_SOURCE[0]}"; then
      echo "ok   — release-agent.sh and this script share $p"
    else
      echo "FAIL — release-agent.sh and this script no longer share $p"; fails=1
    fi
  done
  return "$fails"
}

case "${1:-}" in
  --self-test) self_test ;;
  "" | -*) echo "usage: $0 <sha> [env-file] | --self-test" >&2; exit 2 ;;
  *) pointer "$1" "${2:-$HERE/../brain/api.env}" ;;
esac
