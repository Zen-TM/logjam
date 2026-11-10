#!/usr/bin/env bash
# What the deploy and rollback workflows ask of the brain's settings file,
# infra/terraform/envs/prod/brain.auto.tfvars: the same file Terraform reads,
# so a workflow and the infrastructure can never disagree about the mode.
#
#   brain-setting.sh <name>                   print the value of a one-line
#                                             setting; fail on anything else
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

  # The workflows: with the brain serving no Elastic Beanstalk step may run.
  # A step that touches EB (the deploy action, the CLI, the bundle it ships, the
  # Dockerrun it edits) must be skipped on steps.mode.outputs.serving; each
  # workflow that decides by the mode reads it through this script. Mutation:
  # dropping that `if` from any such step, or a new EB step without it.
  local wf name left
  for wf in deploy-api rollback; do
    left=$(eb_steps_without_the_mode "$HERE/../../.github/workflows/$wf.yml")
    if [ -z "$left" ]; then ok "$wf.yml: every Elastic Beanstalk step is skipped when the brain serves"
    else bad "$wf.yml: runs when the brain serves:$left"; fi
  done
  for wf in deploy-api rollback deploy-guard; do
    if grep -q 'brain-setting\.sh brain_serving' "$HERE/../../.github/workflows/$wf.yml"; then
      ok "$wf.yml reads brain_serving through this script"
    else bad "$wf.yml does not read brain_serving through this script"; fi
  done

  [ "$fails" -eq 0 ] || { echo "self-test failed"; return 1; }
  echo "self-test passed"
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
  --check-taskdef) check_taskdef "${2:-}" ;;
  "" | -*) echo "usage: $0 <setting> | --check-taskdef on|off | --self-test" >&2; exit 2 ;;
  *) setting "$1" ;;
esac
