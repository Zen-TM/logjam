#!/usr/bin/env bash
# What the deploy and rollback workflows ask of the brain's settings file,
# infra/terraform/envs/prod/brain.auto.tfvars: the same file Terraform reads,
# so a workflow and the infrastructure can never disagree about the mode.
#
#   brain-setting.sh <name>   print the value of a one-line setting; fail on
#                             anything else
#   brain-setting.sh --self-test
#
# It fails rather than guess: a missing file, a missing or repeated setting, a
# value that is not a bare true/false (for the switches) or a quoted string,
# all stop the caller before anything is deployed. A setting spread over
# several lines (brain_data_volumes) is not readable here, by design.
# BRAIN_TFVARS names another file (the self-test does).
#
# The workflows ask one thing, brain_serving: whether the brain's API runs, and
# so whether a smoke test can see the release they write.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWITCHES=" brain_serving brain_bootstrap "

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
  expect "other settings around it"    brain_bootstrap false $'brain_serving = true\nbrain_bootstrap = false\nbrain_instance_type = "t4g.micro"\n'
  expect "a commented-out line is ignored" brain_serving false $'# brain_serving = true\nbrain_serving = false\n'
  expect "a similar name is not it"    brain_serving false $'brain_serving_x = true\nbrain_serving = false\n'
  expect "a missing setting fails"     brain_bootstrap FAIL $'brain_serving = false\n'
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
  for s in brain_serving brain_bootstrap; do
    case $(setting "$s") in true | false) ok "the committed file has $s" ;; *) bad "the committed file has $s" ;; esac
  done

  # The workflows read brain_serving from the file and nothing else decides
  # whether a release is smoke-tested. Mutations: a workflow that stops reading
  # it; the deploy's swap marker losing its condition (a smoke test against a
  # public /meta that cannot name the release rolls a healthy one back); the
  # rollback's smoke job losing its.
  local wf f
  for wf in deploy-api rollback; do
    f="$HERE/../../.github/workflows/$wf.yml"
    if grep -q 'brain-setting\.sh brain_serving' "$f"; then ok "$wf.yml reads brain_serving from the file"
    else bad "$wf.yml does not read brain_serving from the file"; fi
  done
  if step_has deploy-api "Mark the swap" "steps.serving.outputs.serving == 'true'"; then
    ok "deploy-api.yml: the swap is marked only when the brain serves"
  else bad "deploy-api.yml: the swap is not gated on brain_serving"; fi
  if grep -q "needs.rollback.outputs.verify != 'false'" "$HERE/../../.github/workflows/rollback.yml" &&
    grep -q 'verify: ${{ steps.serving.outputs.serving }}' "$HERE/../../.github/workflows/rollback.yml"; then
    ok "rollback.yml: the smoke test runs only where the brain serves"
  else bad "rollback.yml: the smoke test is not gated on brain_serving"; fi

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

case "${1:-}" in
  --self-test) self_test ;;
  "" | -*) echo "usage: $0 <setting> | --self-test" >&2; exit 2 ;;
  *) setting "$1" ;;
esac
