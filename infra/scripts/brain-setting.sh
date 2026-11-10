#!/usr/bin/env bash
# What the deploy and rollback workflows ask of the brain's settings file,
# infra/terraform/envs/prod/brain.auto.tfvars: the same file Terraform reads,
# so a workflow and the infrastructure can never disagree about the mode.
#
#   brain-setting.sh <name>                   print the value of a one-line
#                                             setting; fail on anything else
#   brain-setting.sh --mode [serving public]  print what the workflows decide by,
#                                             one key=value per line, ready for
#                                             $GITHUB_OUTPUT (the arguments are
#                                             for the self-test; the file is read
#                                             without them)
#   brain-setting.sh --live                   print the sha the public API runs
#                                             (empty when unknown; never fails)
#   brain-setting.sh --check-taskdef on|off   read `aws ecs describe-task-definition
#                                             --query taskDefinition` on stdin:
#                                             does its database match the mode?
#   brain-setting.sh --self-test
#
# It fails rather than guess: a missing file, a missing or repeated setting, a
# value that is not a bare true/false (for the switches) or a quoted string,
# all stop the caller before anything is deployed. A setting spread over
# several lines (brain_data_volumes) is not readable here, by design.
# BRAIN_TFVARS names another file (the self-test does).
#
# --mode: the one table the deploy and rollback workflows read, so the decision
# is written once and tested here, not in YAML:
#
#   brain_serving  brain_public | live  swap_brain  verify  attempts
#   false          false        | eb    false       true    18       Elastic Beanstalk serves; its deploy step marks the swap
#   true           false        | meta  false       false   30       the brain runs but the public URL is still Elastic
#                               |                                    Beanstalk's: no smoke test can see it, so none runs
#   true           true         | meta  true        true    30       the public /meta shows the brain: smoke waits 5 minutes
#   false          true         | refused (Terraform refuses it too)
#
# `live` is where "what is live" comes from (--live reads it); `swap_brain`
# marks the swap for the brain's path; `verify` is whether a smoke test can see
# the release.
#
# --check-taskdef: the ECS task definitions are Terraform's, and the file's
# change reaches them in the same merge's apply. A deploy that starts before
# that apply has landed would run the migration against the wrong database, so
# the deploy asks the revision it just pinned. `on` means the brain (a
# DATABASE_SSL_CA and a DB_HOST that is not RDS), `off` means RDS (neither).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCHES=" brain_serving brain_public brain_bootstrap "

setting() {
  local name=$1 file=${BRAIN_TFVARS:-$HERE/../terraform/envs/prod/brain.auto.tfvars}
  local lines n raw value
  if ! [[ "$name" =~ ^[a-z_]+$ ]]; then
    echo "brain-setting: '$name' is not a setting name" >&2; return 1
  fi
  [ -r "$file" ] || { echo "brain-setting: cannot read $file" >&2; return 1; }
  lines=$(grep -E "^[[:space:]]*$name[[:space:]]*=" "$file" || true)
  n=$(grep -c . <<<"$lines" || true)
  if [ "$n" -ne 1 ]; then
    echo "brain-setting: expected $name once in $file, found $n" >&2; return 1
  fi
  # The value, without a trailing comment: a bare word, or a quoted string
  # without a quote, a backslash or a # inside.
  raw=$(sed -E 's/^[^=]*=[[:space:]]*//; s/[[:space:]]*(#.*)?$//' <<<"$lines")
  if [[ "$raw" =~ ^\"[^\"\\#]*\"$ ]]; then
    value=${raw:1:${#raw}-2}
    if [[ "$SWITCHES" == *" $name "* ]]; then
      echo "brain-setting: $name must be a bare true or false, not $raw" >&2; return 1
    fi
  elif [[ "$raw" =~ ^(true|false)$ ]]; then
    value=$raw
  else
    echo "brain-setting: cannot read the value of $name in $file (got '$raw')" >&2; return 1
  fi
  printf '%s\n' "$value"
}

# mode [serving public]: the table in the header, as key=value lines.
mode() {
  local serving=${1-} public=${2-}
  [ -n "$serving" ] || serving=$(setting brain_serving)
  [ -n "$public" ] || public=$(setting brain_public)
  case "$serving:$public" in
    false:false)
      printf '%s\n' serving=false public=false live=eb swap_brain=false verify=true attempts=18 ;;
    true:false)
      printf '%s\n' serving=true public=false live=meta swap_brain=false verify=false attempts=30 ;;
    true:true)
      printf '%s\n' serving=true public=true live=meta swap_brain=true verify=true attempts=30 ;;
    *)
      echo "brain-setting: brain_serving=$serving brain_public=$public is not a mode (brain_public needs brain_serving)" >&2
      return 1 ;;
  esac
}

# live: the sha the public API runs. Elastic Beanstalk's version label while it
# serves, the public /meta once the brain does (CI cannot read the brain's
# signals bucket). Empty on any failure, which the guard treats as unknown;
# needs EB_ENVIRONMENT and API_URL in the environment.
live() {
  local src sha=""
  src=$(mode | sed -n 's/^live=//p') || src=""
  case "$src" in
    meta)
      sha=$(curl -sSf --max-time 15 "${API_URL:?}/meta" | jq -r .sha) || sha="" ;;
    eb)
      sha=$(aws elasticbeanstalk describe-environments --environment-names "${EB_ENVIRONMENT:?}" \
        --query 'Environments[0].VersionLabel' --output text) || sha="" ;;
  esac
  printf '%s\n' "$sha"
}

# check_taskdef <on|off>, JSON on stdin. Prints why on failure.
check_taskdef() {
  local mode=$1 json db ca
  case "$mode" in on | off) ;; *) echo "brain-setting: mode is on or off" >&2; return 2 ;; esac
  json=$(cat)
  if ! db=$(jq -er '[.containerDefinitions[0].environment[] | select(.name == "DB_HOST") | .value] | if length == 1 then .[0] else error("DB_HOST not exactly once") end' <<<"$json" 2>/dev/null); then
    echo "brain-setting: the task definition has no single DB_HOST" >&2; return 1
  fi
  ca=$(jq -r '[.containerDefinitions[0].environment[] | select(.name == "DATABASE_SSL_CA") | .value] | .[0] // ""' <<<"$json")
  if [ "$mode" = on ]; then
    if [[ "$db" == *.rds.amazonaws.com ]] || [ -z "$db" ] || [ -z "$ca" ]; then
      echo "brain-setting: brain_serving is on but the task definition still has DB_HOST=${db:-<empty>} and DATABASE_SSL_CA='${ca}': Terraform's apply for this change has not landed (terraform-apply.yml). Re-run once it has." >&2
      return 1
    fi
  else
    if ! [[ "$db" == *.rds.amazonaws.com ]] || [ -n "$ca" ]; then
      echo "brain-setting: brain_serving is off but the task definition has DB_HOST=${db:-<empty>} and DATABASE_SSL_CA='${ca}': Terraform's apply for this change has not landed (terraform-apply.yml). Re-run once it has." >&2
      return 1
    fi
  fi
}

self_test() {
  local dir fails=0 out
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' RETURN
  ok() { echo "ok   — $1"; }
  bad() { echo "FAIL — $1"; fails=1; }
  # expect <description> <setting> <want value | FAIL> <file content>
  expect() {
    printf '%s' "$4" > "$dir/f.tfvars"
    if out=$(BRAIN_TFVARS="$dir/f.tfvars" setting "$2" 2>/dev/null); then
      [ "$out" = "$3" ] && ok "$1" || bad "$1 (got '$out')"
    else
      [ "$3" = FAIL ] && ok "$1" || bad "$1 (failed)"
    fi
  }
  expect "a bare false"                brain_serving false $'brain_serving = false\n'
  expect "a bare true, no spaces"      brain_serving true  $'brain_serving=true\n'
  expect "a comment after the value"   brain_serving true  $'brain_serving = true # on at cutover\n'
  expect "a quoted string"             brain_pg_image_tag abc123 $'brain_pg_image_tag = "abc123"\n'
  expect "an empty quoted string"      brain_pg_image_tag "" $'brain_pg_image_tag = ""\n'
  expect "other settings around it"    brain_public false $'brain_serving = true\nbrain_public = false\nbrain_bootstrap = true\n'
  expect "a commented-out line is ignored" brain_serving false $'# brain_serving = true\nbrain_serving = false\n'
  expect "a similar name is not it"    brain_serving false $'brain_serving_x = true\nbrain_serving = false\n'
  expect "a missing setting fails"     brain_public FAIL $'brain_serving = false\n'
  expect "an empty file fails"         brain_serving FAIL ''
  expect "a repeated setting fails"    brain_serving FAIL $'brain_serving = false\nbrain_serving = true\n'
  expect "a quoted switch fails"       brain_serving FAIL $'brain_serving = "true"\n'
  expect "a word that is not a boolean fails" brain_serving FAIL $'brain_serving = yes\n'
  expect "an expression fails"         brain_serving FAIL $'brain_serving = var.x\n'
  expect "a multi-line map fails"      brain_data_volumes FAIL $'brain_data_volumes = {\n  "1" = { az = "a", size_gb = 20 }\n}\n'
  expect "an unterminated string fails" brain_pg_image_tag FAIL $'brain_pg_image_tag = "abc\n'
  if BRAIN_TFVARS="$dir/none" setting brain_serving > /dev/null 2>&1; then bad "a missing file fails"; else ok "a missing file fails"; fi
  if setting 'a b' > /dev/null 2>&1; then bad "a bad name fails"; else ok "a bad name fails"; fi
  # The file the workflows really read parses, and says what the PR says.
  for s in brain_serving brain_public brain_bootstrap; do
    case $(setting "$s") in true | false) ok "the committed file has $s" ;; *) bad "the committed file has $s" ;; esac
  done

  td() { # td <db host> [ssl ca]: a trimmed describe-task-definition
    jq -n --arg h "$1" --arg ca "${2:-}" '{containerDefinitions: [{environment:
      ([{name: "DB_HOST", value: $h}, {name: "DB_NAME", value: "logjam"}]
       + (if $ca == "" then [] else [{name: "DATABASE_SSL_CA", value: $ca}] end))}]}'
  }
  local rds=logjam-db-enc.x.ap-southeast-2.rds.amazonaws.com brain=ec2-1-2-3-4.ap-southeast-2.compute.amazonaws.com
  # tdcheck <description> <mode> <want 0|1> <json>
  tdcheck() {
    if check_taskdef "$2" <<<"$4" 2>/dev/null; then out=0; else out=1; fi
    [ "$out" = "$3" ] && ok "$1" || bad "$1"
  }
  tdcheck "off: RDS and no certificate"           off 0 "$(td $rds)"
  tdcheck "off: the brain's name is refused"      off 1 "$(td $brain /app/brain-ca.pem)"
  tdcheck "off: a certificate on RDS is refused"  off 1 "$(td $rds /app/brain-ca.pem)"
  tdcheck "off: the brain's name without a certificate is refused" off 1 "$(td $brain)"
  tdcheck "on: the brain and its certificate"     on 0 "$(td $brain /app/brain-ca.pem)"
  tdcheck "on: still RDS is refused"              on 1 "$(td $rds)"
  tdcheck "on: the brain's name without a certificate is refused" on 1 "$(td $brain)"
  tdcheck "on: an empty DB_HOST is refused"       on 1 "$(td '' /app/brain-ca.pem)"
  tdcheck "no DB_HOST at all is refused"          on 1 '{"containerDefinitions":[{"environment":[]}]}'
  tdcheck "garbage is refused"                    off 1 'not json'

  # The mode table. Mutation: any cell changed (say swap_brain true when
  # brain_public is false, or the live source swapped).
  # modecheck <description> <serving> <public> <expected lines, space separated | FAIL>
  modecheck() {
    if out=$(mode "$2" "$3" 2>/dev/null | tr '\n' ' '); then
      [ "$out" = "$4 " ] && ok "$1" || bad "$1 (got '$out')"
    else
      [ "$4" = FAIL ] && ok "$1" || bad "$1 (failed)"
    fi
  }
  modecheck "mode: serving off"                   false false "serving=false public=false live=eb swap_brain=false verify=true attempts=18"
  modecheck "mode: serving on, public off"        true  false "serving=true public=false live=meta swap_brain=false verify=false attempts=30"
  modecheck "mode: serving on, public on"         true  true  "serving=true public=true live=meta swap_brain=true verify=true attempts=30"
  modecheck "mode: public without serving"        false true  FAIL
  modecheck "mode: from the file"                 "" "" "$(BRAIN_TFVARS="$HERE/../terraform/envs/prod/brain.auto.tfvars" mode | tr '\n' ' ' | sed 's/ $//')"
  # --live asks Elastic Beanstalk or the public /meta by mode, never both.
  # Mutation: the two arms of live() swapped.
  stubdir=$(mktemp -d)
  printf '#!/bin/sh\necho EB-SHA\n' > "$stubdir/aws"
  printf '#!/bin/sh\necho "{\\"sha\\":\\"META-SHA\\"}"\n' > "$stubdir/curl"
  chmod +x "$stubdir/aws" "$stubdir/curl"
  livecheck() { # livecheck <description> <tfvars content> <want>
    printf '%s' "$2" > "$dir/l.tfvars"
    out=$(PATH="$stubdir:$PATH" BRAIN_TFVARS="$dir/l.tfvars" EB_ENVIRONMENT=env API_URL=https://x live 2>/dev/null)
    [ "$out" = "$3" ] && ok "$1" || bad "$1 (got '$out')"
  }
  livecheck "live: serving off asks Elastic Beanstalk"      $'brain_serving = false\nbrain_public = false\n' EB-SHA
  livecheck "live: serving on, public off asks /meta"       $'brain_serving = true\nbrain_public = false\n' META-SHA
  livecheck "live: serving on, public on asks /meta"        $'brain_serving = true\nbrain_public = true\n' META-SHA
  livecheck "live: an unreadable file is unknown, not a guess" $'brain_serving = maybe\n' ""
  printf '#!/bin/sh\nexit 22\n' > "$stubdir/curl"
  livecheck "live: a failed lookup is unknown"              $'brain_serving = true\nbrain_public = true\n' ""
  rm -rf "$stubdir"

  # The workflows read the table and nothing else. Mutations: the `if` of an
  # Elastic Beanstalk step dropped; the brain's swap step losing its condition
  # on swap_brain (back to brain_serving alone, which runs a smoke test against
  # Elastic Beanstalk's /meta and rolls a healthy brain release back); a smoke
  # job asking for another attempt count than the table's.
  local wf left
  for wf in deploy-api rollback; do
    left=$(eb_steps_without_the_mode "$HERE/../../.github/workflows/$wf.yml")
    if [ -z "$left" ]; then ok "$wf.yml: every Elastic Beanstalk step is skipped when the brain serves"
    else bad "$wf.yml: runs when the brain serves:$left"; fi
  done
  for wf in deploy-api rollback; do
    f="$HERE/../../.github/workflows/$wf.yml"
    if grep -q 'brain-setting\.sh --mode' "$f" && grep -q "attempts: \${{ fromJSON(needs\\.[a-z]*\\.outputs\\.attempts || '18') }}" "$f"; then
      ok "$wf.yml takes the mode and the smoke attempts from the table"
    else bad "$wf.yml does not take the mode and attempts from the table"; fi
  done
  if step_has deploy-api "Mark the swap (the brain)" "steps.mode.outputs.swap_brain == 'true'" &&
    ! step_has deploy-api "Mark the swap (the brain)" "steps.mode.outputs.serving"; then
    ok "deploy-api.yml: the brain's swap is marked only on the table's swap_brain"
  else bad "deploy-api.yml: the brain's swap is not gated on swap_brain alone"; fi
  if step_has rollback "Roll back the API's task definitions (the brain)" "steps.mode.outputs.serving == 'true'" &&
    grep -q "needs.rollback.outputs.verify != 'false'" "$HERE/../../.github/workflows/rollback.yml"; then
    ok "rollback.yml: the smoke test runs only where the table says verify"
  else bad "rollback.yml: the smoke test is not gated on verify"; fi
  if grep -q 'brain-setting\.sh --live' "$HERE/../../.github/workflows/deploy-guard.yml"; then
    ok "deploy-guard.yml asks --live for the live sha"
  else bad "deploy-guard.yml does not ask --live for the live sha"; fi

  [ "$fails" -eq 0 ] || { echo "self-test failed"; return 1; }
  echo "self-test passed"
}

# step_has <workflow> <step name> <text>: does that step (comments left out) contain the text?
step_has() {
  awk -v want="$3" -v step="$2" '
    function flush() { if (name == step && index(blk, want)) found = 1 }
    /^      - / { flush(); blk = ""; name = $0; sub(/^ *- (name: )?/, "", name) }
    /^ *#/ { next }
    { blk = blk "\n" $0 }
    END { flush(); exit found ? 0 : 1 }
  ' "$HERE/../../.github/workflows/$1.yml"
}

# The names of the steps in a workflow file that mention Elastic Beanstalk and
# do not carry the skip. Steps start at six spaces and a dash; comments are
# not part of one.
eb_steps_without_the_mode() {
  awk '
    function flush() {
      if (blk ~ /elasticbeanstalk|beanstalk-deploy|Dockerrun|deploy\.zip/ && blk !~ /steps\.mode\.outputs\.serving != .true./) printf " [%s]", name
    }
    /^      - / { flush(); blk = ""; name = $0; sub(/^ *- (name: )?/, "", name) }
    /^ *#/ { next }
    { blk = blk "\n" $0 }
    END { flush() }
  ' "$1"
}

case "${1:-}" in
  --self-test) self_test ;;
  --mode) mode "${2-}" "${3-}" ;;
  --live) live ;;
  --check-taskdef) check_taskdef "${2:-}" ;;
  "" | -*) echo "usage: $0 <setting> | --mode | --live | --check-taskdef on|off | --self-test" >&2; exit 2 ;;
  *) setting "$1" ;;
esac
