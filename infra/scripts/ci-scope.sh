#!/usr/bin/env bash
# Which of ci.yml's heavy jobs a pull request needs, so a docs change does not
# stand up Postgres, MiniStack and the API. Writes `<area>=true|false` for
# every area to $GITHUB_OUTPUT (stdout when unset); ci.yml's `changes` job
# passes them on, and each scoped job runs unless its area is `false`.
#
#   ci-scope.sh scope <base> <head>
#   ci-scope.sh all              # every area true: pushes, schedule, dispatch
#   ci-scope.sh --self-test
#
# Only heavy jobs are scoped. The quick ones (lint, unit, format, gitleaks)
# always run: several read files outside their package (ADRs, issue forms), so
# scoping them would need a map of every file a test opens.
#
# Fails OPEN, like image-build-scope.sh: a diff that cannot be read runs
# everything, and so does a change to this script or to ci.yml. ci.yml's `if:`
# compares to 'false', so a failed `changes` job (no output) runs the job too.
#
# paths_for is the one declaration of what each area depends on: its own
# package, everything it imports, and every file its tests read.
#
# Mutations that turn the self-test red: dropping shared/ from mobile fails
# "mobile: shared source"; dropping frontend/ from api_integration fails
# "api_integration: Logjam Web (Playwright smoke)"; removing the ci.yml rule
# fails "any area: ci.yml".
set -uo pipefail

AREAS="api_integration mobile migrations"

# A change to the gate itself runs the whole gate.
ALWAYS='^(\.github/workflows/ci\.yml|infra/scripts/ci-scope\.sh)$'

paths_for() {
  case "$1" in
    # The live-API suite, the topo status guard against its Postgres (it
    # imports topo's top-level modules), and the Playwright smoke spec.
    api_integration) echo '^(api/|shared/|frontend/|topo/([^/]+\.py|requirements[^/]*\.txt|tests/(test_status_guard_db|_native_stub)\.py)$)' ;;
    mobile) echo '^(mobile/|shared/)' ;;
    # Both migration jobs: migrations on an empty DB, and origin/main's seed
    # upgraded to this commit (the head's seed never runs there).
    migrations) echo '^(api/(prisma/|prisma\.config\.ts|package(-lock)?\.json)|scripts/migration-upgrade-test\.sh)' ;;
    *) return 1 ;;
  esac
}

emit() {
  echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/stdout}"
  [ -n "${GITHUB_OUTPUT:-}" ] && echo "==> $1=$2"
  return 0
}

# decide <rc of the diff> <changed files, one per line>
decide() {
  local rc=$1 files=$2 area
  if [ "$rc" != 0 ]; then
    echo "::warning::could not read the diff, running every job (fail open). Said: $files"
    all; return
  fi
  if grep -qE "$ALWAYS" <<<"$files"; then all; return; fi
  for area in $AREAS; do
    if grep -qE "$(paths_for "$area")" <<<"$files"; then emit "$area" true; else emit "$area" false; fi
  done
}

all() {
  local area
  for area in $AREAS; do emit "$area" true; done
}

self_test() {
  local fails=0 tmp got
  tmp=$(mktemp)
  # check <description> <area> <expected> <rc> <files>
  check() {
    local desc=$1 area=$2 want=$3; shift 3
    : > "$tmp"
    GITHUB_OUTPUT=$tmp decide "$@" > /dev/null
    got=$(sed -n "s/^$area=//p" "$tmp")
    if [ "$got" = "$want" ]; then echo "ok   — $desc"; else echo "FAIL — $desc: want $want, got '$got'"; fails=1; fi
  }

  check "api_integration: api source"                     api_integration true  0 'api/src/routes/places.ts'
  check "api_integration: shared source"                  api_integration true  0 'shared/src/sync.ts'
  check "api_integration: Logjam Web (Playwright smoke)"  api_integration true  0 'frontend/src/main.tsx'
  check "api_integration: topo module the guard imports"  api_integration true  0 'topo/worker.py'
  check "api_integration: the guard test"                 api_integration true  0 'topo/tests/test_status_guard_db.py'
  check "api_integration: topo requirements"              api_integration true  0 'topo/requirements.txt'
  check "api_integration: other topo test"                api_integration false 0 'topo/tests/test_labels.py'
  check "api_integration: topo renderer"                  api_integration false 0 'topo/renderers/a.py'
  check "api_integration: mobile only"                    api_integration false 0 'mobile/src/a.ts'
  check "api_integration: docs only"                      api_integration false 0 $'docs/a.md\nREADME.md'
  check "mobile: source"                                  mobile true  0 'mobile/app.json'
  check "mobile: shared source"                           mobile true  0 'shared/src/a.ts'
  check "mobile: api only"                                mobile false 0 'api/src/a.ts'
  check "migrations: a migration"                         migrations true  0 'api/prisma/migrations/2026/migration.sql'
  check "migrations: upgrade checks"                      migrations true  0 'api/prisma/upgrade-check/verify.sql'
  check "migrations: the Prisma version"                  migrations true  0 'api/package.json'
  check "migrations: the upgrade script"                  migrations true  0 'scripts/migration-upgrade-test.sh'
  check "migrations: api route"                           migrations false 0 'api/src/routes/a.ts'
  check "any area: ci.yml"                                mobile true  0 $'docs/a.md\n.github/workflows/ci.yml'
  check "any area: this script"                           migrations true  0 'infra/scripts/ci-scope.sh'
  check "other workflow is not the gate"                  mobile false 0 '.github/workflows/smoke.yml'
  check "empty diff"                                      api_integration false 0 ''
  check "diff unreadable"                                 mobile true  128 'fatal: bad revision'

  # Every area ci.yml reads is declared here, and the reverse, so an area
  # added on one side only fails here rather than running or skipping wrong.
  local yml declared
  yml=$(grep -oE 'needs\.changes\.outputs\.[a-z0-9_]+' "$(dirname "${BASH_SOURCE[0]}")/../../.github/workflows/ci.yml" | sed 's/.*\.//' | sort -u | tr '\n' ' ')
  declared=$(tr ' ' '\n' <<<"$AREAS" | sort -u | tr '\n' ' ')
  if [ "$yml" = "$declared" ]; then echo "ok   — ci.yml reads exactly the declared areas"; else echo "FAIL — ci.yml reads [$yml], declared [$declared]"; fails=1; fi

  rm -f "$tmp"
  return $fails
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --self-test) self_test ;;
    all) all ;;
    scope)
      FILES=$(git diff --name-only "${2:?base}...${3:?head}" 2>&1)
      decide "$?" "$FILES"
      ;;
    *) echo "usage: $0 scope <base> <head> | all | --self-test" >&2; exit 2 ;;
  esac
fi
