#!/usr/bin/env bash
# Which heavy CI jobs a pull request needs, so a docs change does not stand up
# Postgres, MiniStack and the API. ci.yml, rollback-compat.yml, terraform-ci.yml
# and setup-smoke.yml each run it in a `changes` job. Writes `<area>=true|false` for
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
# "mobile: shared source"; dropping frontend/public/ from mobile fails "mobile:
# the legal documents it links to"; dropping frontend/ from api_integration
# fails "api_integration: Logjam Web (Playwright smoke)"; dropping the stub
# from api_integration fails "api_integration: the Expo push stub it starts";
# removing the ci.yml rule fails "any area: ci.yml"; dropping --no-renames
# fails "a rename out of an area"; dropping the worker image's paths from
# topo_e2e fails "topo_e2e: worker source" and dropping the RunTask files fails
# "topo_e2e: the start route"; dropping lockfiles from setup_smoke
# fails "setup_smoke: a nested lockfile"; a scoped job in any workflow whose
# `if:` is not the fail-open expression, or a `changes` output wired to another
# area's value, fails that workflow's checks.
set -uo pipefail

AREAS="api_integration mobile migrations topo_e2e rollback_compat terraform setup_smoke"

# A change to the gate itself runs the whole gate.
ALWAYS='^(\.github/workflows/ci\.yml|infra/scripts/ci-scope\.sh)$'

paths_for() {
  case "$1" in
    # The live-API suite, the topo status guard against its Postgres (it
    # imports topo's top-level modules), the Playwright smoke spec and the Expo
    # push stub the job starts.
    api_integration) echo '^(api/|shared/|frontend/|infra/scripts/expo-push-stub\.mjs$|topo/([^/]+\.py|requirements[^/]*\.txt|tests/(test_status_guard_db|_native_stub)\.py)$)' ;;
    # legalLinks.test.ts checks the documents the consent screen links to.
    mobile) echo '^(mobile/|shared/|frontend/public/)' ;;
    # Both migration jobs: migrations on an empty DB, and origin/main's seed
    # upgraded to this commit (the head's seed never runs there).
    migrations) echo '^(api/(prisma/|prisma\.config\.ts|package(-lock)?\.json)|scripts/migration-upgrade-test\.sh)' ;;
    # The worker image (image-build-scope.sh holds what it is built from), the
    # job's stubs and checks, its sample input, the task definition whose env
    # worker.env mirrors, and the settings the job submits (the worker
    # re-validates them in Python), and the API files that launch the worker
    # through RunTask: the helper, the route and the ECS client. lib/env.ts is
    # left out: its ECS_SUBNETS parsing has a unit test, and most env changes
    # are for other variables.
    topo_e2e) echo "$(bash -c "source '$(dirname "${BASH_SOURCE[0]}")/image-build-scope.sh'; image_paths_for worker")|^(topo/tests/e2e/|scripts/sample-data\\.|infra/terraform/envs/prod/ecs\\.tf$|shared/src/topoSettings\\.ts$|api/src/(lib/ecsRunTask|routes/topoJobs|services/awsClients)\\.ts$)" ;;
    # A migration, run under the live release (rollback-compat.yml).
    rollback_compat) echo '^(api/prisma/migrations/|\.github/workflows/rollback-compat\.yml$)' ;;
    # Static Terraform checks and the plan-comment tests (terraform-ci.yml).
    terraform) echo '^(infra/terraform/|infra/scripts/plan-summary|infra/scripts/__fixtures__/|\.github/workflows/terraform-ci\.yml$)' ;;
    # What `make setup` reads on a fresh machine (setup-smoke.yml).
    setup_smoke) echo '^(mise\.toml|Makefile|docs/dev-setup\.md|\.github/workflows/setup-smoke\.yml)$|(^|/)package-lock\.json$|^topo/requirements[^/]*\.txt$' ;;
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
  check "api_integration: the Expo push stub it starts"   api_integration true  0 'infra/scripts/expo-push-stub.mjs'
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
  check "mobile: the legal documents it links to"         mobile true  0 'frontend/public/tos.html'
  check "migrations: a migration"                         migrations true  0 'api/prisma/migrations/2026/migration.sql'
  check "migrations: upgrade checks"                      migrations true  0 'api/prisma/upgrade-check/verify.sql'
  check "migrations: the Prisma version"                  migrations true  0 'api/package.json'
  check "migrations: the upgrade script"                  migrations true  0 'scripts/migration-upgrade-test.sh'
  check "migrations: api route"                           migrations false 0 'api/src/routes/a.ts'
  check "topo_e2e: worker source"                         topo_e2e true  0 'topo/pipeline.py'
  check "topo_e2e: worker image Dockerfile"               topo_e2e true  0 'topo/Dockerfile'
  check "topo_e2e: its stub and checks"                   topo_e2e true  0 'topo/tests/e2e/check.py'
  check "topo_e2e: the sample manifest"                   topo_e2e true  0 'scripts/sample-data.sha256'
  check "topo_e2e: the task definition"                   topo_e2e true  0 'infra/terraform/envs/prod/ecs.tf'
  check "topo_e2e: the settings it sends"                 topo_e2e true  0 'shared/src/topoSettings.ts'
  check "topo_e2e: another shared source"                 topo_e2e false 0 'shared/src/sync.ts'
  check "topo_e2e: a topo unit test"                      topo_e2e false 0 'topo/tests/test_labels.py'
  check "topo_e2e: the RunTask helper"                    topo_e2e true  0 'api/src/lib/ecsRunTask.ts'
  check "topo_e2e: the start route"                       topo_e2e true  0 'api/src/routes/topoJobs.ts'
  check "topo_e2e: the ECS client"                       topo_e2e true  0 'api/src/services/awsClients.ts'
  check "topo_e2e: api only"                              topo_e2e false 0 'api/src/routes/media.ts'
  check "any area: ci.yml"                                mobile true  0 $'docs/a.md\n.github/workflows/ci.yml'
  check "any area: this script"                           migrations true  0 'infra/scripts/ci-scope.sh'
  check "other workflow is not the gate"                  mobile false 0 '.github/workflows/smoke.yml'
  check "rollback_compat: a migration"                    rollback_compat true  0 'api/prisma/migrations/2026/migration.sql'
  check "rollback_compat: its workflow"                   rollback_compat true  0 '.github/workflows/rollback-compat.yml'
  check "rollback_compat: the schema alone"               rollback_compat false 0 'api/prisma/schema.prisma'
  check "terraform: a root"                               terraform true  0 'infra/terraform/envs/prod/ecs.tf'
  check "terraform: the plan-summary script"              terraform true  0 'infra/scripts/plan-summary.mjs'
  check "terraform: its workflow"                         terraform true  0 '.github/workflows/terraform-ci.yml'
  check "terraform: another infra script"                 terraform false 0 'infra/scripts/deploy-guard.sh'
  check "setup_smoke: a nested lockfile"                  setup_smoke true  0 'frontend/package-lock.json'
  check "setup_smoke: the root lockfile"                  setup_smoke true  0 'package-lock.json'
  check "setup_smoke: mise.toml"                          setup_smoke true  0 'mise.toml'
  check "setup_smoke: topo requirements"                  setup_smoke true  0 'topo/requirements-test.txt'
  check "setup_smoke: the guide"                          setup_smoke true  0 'docs/dev-setup.md'
  check "setup_smoke: a package.json alone"               setup_smoke false 0 'api/package.json'
  check "empty diff"                                      api_integration false 0 ''
  check "diff unreadable"                                 mobile true  128 'fatal: bad revision'

  # Every workflow that runs this script agrees with AREAS, in all three
  # places a skip could go wrong.
  local wf declared yml all_reads="" bad needs reads outs
  declared=$(tr ' ' '\n' <<<"$AREAS" | sort -u | tr '\n' ' ')
  ok_if() { if [ -z "$2" ]; then echo "ok   — $1"; else echo "FAIL — $1: $2"; fails=1; fi; }
  for wf in "$(dirname "${BASH_SOURCE[0]}")"/../../.github/workflows/*.yml; do
    grep -q 'ci-scope\.sh scope' "$wf" || continue
    local name; name=$(basename "$wf")
    yml=$(grep -oE 'needs\.changes\.outputs\.[a-z0-9_]+' "$wf" | sed 's/.*\.//' | sort -u | tr '\n' ' ')
    all_reads="$all_reads $yml"
    # Each scoped job reads its area through the fail-open expression...
    bad=$(grep -E 'needs\.changes\.outputs\.' "$wf" | grep -vE "^    if: \\$\\{\\{ !cancelled\\(\\) && needs\\.changes\\.outputs\\.[a-z0-9_]+ != 'false' \\}\\}$" || true)
    ok_if "$name: every scoped job's if: fails open" "$bad"
    needs=$(grep -cE '^    needs: changes$' "$wf"); reads=$(grep -cE 'needs\.changes\.outputs\.' "$wf")
    ok_if "$name: every job that needs changes reads an area" "$([ "$needs" = "$reads" ] || echo "$needs jobs need changes, $reads read an area")"
    # ...and the changes job hands each area it reads its own value.
    bad=$(grep -E '^      [a-z0-9_]+: \$\{\{ steps\.scope\.outputs\.' "$wf" | sed -E 's/^ +([a-z0-9_]+): .*outputs\.([a-z0-9_]+) .*/\1 \2/' | awk '$1 != $2' || true)
    outs=$(grep -oE '^      [a-z0-9_]+: \$\{\{ steps\.scope\.outputs\.' "$wf" | sed -E 's/^ +([a-z0-9_]+):.*/\1/' | sort -u | tr '\n' ' ')
    ok_if "$name: the changes job outputs each area it reads, as itself" "$bad$([ "$outs" = "$yml" ] || echo " outputs [$outs], reads [$yml]")"
  done
  # Together the workflows read exactly the declared areas.
  yml=$(tr ' ' '\n' <<<"$all_reads" | grep . | sort -u | tr '\n' ' ')
  ok_if "the workflows read exactly the declared areas" "$([ "$yml" = "$declared" ] || echo "read [$yml], declared [$declared]")"

  # The diff lists both sides of a rename, unquoted, or a file moved out of an
  # area would scope as if it were never there.
  local repo files
  repo=$(mktemp -d)
  (cd "$repo" && git init -q && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base \
    && mkdir -p api/prisma/migrations && echo x > api/prisma/migrations/m.sql && echo y > 'é.md' \
    && git add -A && git -c user.email=t@t -c user.name=t commit -q -m add \
    && git mv api/prisma/migrations/m.sql m.sql && git -c user.email=t@t -c user.name=t commit -q -m move)
  files=$(cd "$repo" && changed_files HEAD~1 HEAD)
  ok_if "a rename out of an area lists its old path" "$(grep -qx 'api/prisma/migrations/m.sql' <<<"$files" || echo "got: $files")"
  files=$(cd "$repo" && changed_files HEAD~2 HEAD~1)
  ok_if "a non-ASCII path is not quoted" "$(grep -qx 'é.md' <<<"$files" || echo "got: $files")"
  rm -rf "$repo"

  rm -f "$tmp"
  return $fails
}

changed_files() { git -c core.quotePath=false diff --name-only --no-renames "$1...$2"; }

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --self-test) self_test ;;
    all) all ;;
    scope)
      FILES=$(changed_files "${2:?base}" "${3:?head}" 2>&1)
      decide "$?" "$FILES"
      ;;
    *) echo "usage: $0 scope <base> <head> | all | --self-test" >&2; exit 2 ;;
  esac
fi
