#!/usr/bin/env bash
# Whether a pull request changes what a Docker image is built from, so
# .github/workflows/image-build.yml builds that image only then. Writes
# `build=true|false` to $GITHUB_OUTPUT (stdout when unset).
#
#   image-build-scope.sh scope <api|worker> <base> <head>
#   image-build-scope.sh --self-test
#
# Fails OPEN: an unknown target, or a diff that cannot be read, builds. A build
# that runs when it need not costs minutes; one skipped by mistake lets a
# broken image reach main, where merging deploys it. Only a diff that read
# cleanly and touched nothing the image is built from skips.
#
# image_paths_for is the one declaration of what each image is built from: its
# Dockerfile, its COPY sources, and the .dockerignore that shapes the context.
# The self-test holds it to the Dockerfiles, so an added COPY that the list
# misses fails the test rather than a later deploy, and to deploy-guard.sh, so
# a file that changes the worker image also deploys it.
#
# Mutations that turn the self-test red: dropping shared/ from the api list
# fails "api: shared source" and "COPY sources: api"; dropping a topo source
# fails "COPY sources: worker"; dropping a file from deploy-guard.sh's worker
# list fails "deploy-guard.sh covers the worker image".
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

emit() {
  echo "build=$1" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  echo "==> build=$1"
}

image_paths_for() {
  case "$1" in
    api) echo '^(\.dockerignore|api/(Dockerfile|package[^/]*\.json|prisma\.config\.ts|prisma/|tsconfig\.json|src/|assets/)|shared/(package[^/]*\.json|tsconfig\.json|src/))' ;;
    worker) echo '^topo/(Dockerfile|requirements\.txt|worker\.py|pipeline\.py|export_worker\.py|email_send\.py|push_send\.py|worker_common\.py|renderers/|icons/)' ;;
    *) return 1 ;;
  esac
}

# decide <target> <rc of the diff> <changed files, one per line>
decide() {
  local target=$1 rc=$2 files=$3 paths
  if ! paths=$(image_paths_for "$target"); then
    echo "::warning::unknown target '$target', building (fail open)"; emit true; return
  fi
  if [ "$rc" != 0 ]; then
    echo "::warning::could not read the diff, building (fail open). Said: $files"; emit true; return
  fi
  if grep -qE "$paths" <<<"$files"; then emit true; return; fi
  echo "::notice title=Nothing to build::no file the $target image is built from changed"
  emit false
}

# copy_sources <Dockerfile> <path prefix of its build context>: every COPY
# source from the build context (not --from a stage), as a repo path.
copy_sources() {
  local dockerfile=$1 prefix=$2 line word
  local -a words
  while IFS= read -r line; do
    read -r -a words <<<"$line"
    words=("${words[@]:1}")                       # drop COPY
    while [[ "${words[0]:-}" == --* ]]; do words=("${words[@]:1}"); done
    [ "${#words[@]}" -lt 2 ] && continue
    unset 'words[${#words[@]}-1]'                 # drop the destination
    for word in "${words[@]}"; do printf '%s%s\n' "$prefix" "$word"; done
  done < <(grep -E '^COPY ' "$dockerfile" | grep -v -- '--from=')
}

self_test() {
  local fails=0 tmp got
  tmp=$(mktemp)
  # check <description> <expected> <target> <rc> <files>
  check() {
    local desc=$1 want=$2; shift 2
    : > "$tmp"
    GITHUB_OUTPUT=$tmp decide "$@" > /dev/null
    got=$(sed -n 's/^build=//p' "$tmp")
    if [ "$got" = "$want" ]; then echo "ok   — $desc"; else echo "FAIL — $desc: want $want, got '$got'"; fails=1; fi
  }
  # ok <description> <condition passed as a command>
  ok() {
    local desc=$1; shift
    if "$@"; then echo "ok   — $desc"; else echo "FAIL — $desc"; fails=1; fi
  }

  check "api: Dockerfile"                 true  api    0 $'docs/x.md\napi/Dockerfile'
  check "api: dependency manifest"        true  api    0 $'api/package-lock.json'
  check "api: source"                     true  api    0 $'api/src/routes/a.ts'
  check "api: shared source"              true  api    0 $'shared/src/a.ts'
  check "api: build context ignore file"  true  api    0 $'.dockerignore'
  check "api: docs only"                  false api    0 $'docs/x.md\nfrontend/src/a.ts'
  check "api: topo file"                  false api    0 $'topo/worker.py'
  check "worker: Dockerfile"              true  worker 0 $'topo/Dockerfile'
  check "worker: requirements"            true  worker 0 $'topo/requirements.txt'
  check "worker: source"                  true  worker 0 $'topo/worker.py'
  check "worker: renderer"                true  worker 0 $'topo/renderers/a.py'
  check "worker: tests only"              false worker 0 $'topo/tests/test_a.py'
  check "worker: api file"                false worker 0 $'api/src/a.ts'
  check "empty diff"                      false worker 0 ''
  check "diff unreadable"                 true  worker 128 'fatal: bad revision'
  check "unknown target"                  true  mobile 0 $'mobile/a.ts'

  # Each COPY source from the build context matches its image's list. A
  # directory source matches as a directory, so probe it with a file inside.
  covers() {
    local target=$1 dockerfile=$2 prefix=$3 src paths bad=0
    paths=$(image_paths_for "$target")
    while IFS= read -r src; do
      [ -z "$src" ] && continue
      if ! grep -qE "$paths" <<<"$src" && ! grep -qE "$paths" <<<"${src%/}/x"; then
        echo "       $target: COPY source not in the list: $src"; bad=1
      fi
    done < <(copy_sources "$ROOT/$dockerfile" "$prefix")
    return $bad
  }
  ok "COPY sources: api"    covers api    api/Dockerfile ""
  ok "COPY sources: worker" covers worker topo/Dockerfile "topo/"
  # An empty parse would let both checks above pass having checked nothing.
  parsed() { [ -n "$(copy_sources "$1" "$2")" ]; }
  ok "COPY sources: api Dockerfile parses"    parsed "$ROOT/api/Dockerfile" ""
  ok "COPY sources: topo Dockerfile parses"   parsed "$ROOT/topo/Dockerfile" "topo/"

  # A file that changes the worker image must also deploy it: every image
  # source has to match deploy-guard.sh's worker list.
  guard_covers_worker() {
    local guard src bad=0
    guard=$(bash -c "source '$SCRIPT_DIR/deploy-guard.sh'; paths_for worker")
    while IFS= read -r src; do
      [ -z "$src" ] && continue
      if ! grep -qE "$guard" <<<"$src" && ! grep -qE "$guard" <<<"${src%/}/x"; then
        echo "       deploy-guard.sh does not deploy on: $src"; bad=1
      fi
    done < <(copy_sources "$ROOT/topo/Dockerfile" "topo/"; echo topo/Dockerfile)
    return $bad
  }
  ok "deploy-guard.sh covers the worker image" guard_covers_worker

  rm -f "$tmp"
  return $fails
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --self-test) self_test ;;
    scope)
      FILES=$(git diff --name-only "${3:?base}...${4:?head}" 2>&1)
      decide "${2:?target}" "$?" "$FILES"
      ;;
    *) echo "usage: $0 scope <api|worker> <base> <head> | --self-test" >&2; exit 2 ;;
  esac
fi
