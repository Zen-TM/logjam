#!/usr/bin/env bash
# Register a new revision of an ECS task definition pinned to one exact image.
#
# INF-009. The four Fargate task defs shipped with `image = ...:latest`, and
# `latest` is a moving tag: a partial CI push, a re-run, or a hand `docker push`
# silently changes what the next RunTask launches, with nothing in the task def
# recording which build actually ran. api/ already deploys by sha (the EB
# Dockerrun is rewritten with it); the workers did not.
#
# So after CI pushes an image tagged with the commit sha, it calls this once per
# affected family. RunTask resolves a family name to its latest ACTIVE revision
# (api/src/lib/env.ts holds the family names, no revisions), so the revision
# registered here is the one that launches, and `aws ecs describe-task-definition`
# on any past task now names the commit that built it.
#
# The live task def is the input, not a committed JSON template: Terraform still
# owns the env vars, roles and sizing in infra/terraform/envs/prod/ecs.tf. Only
# the image is overwritten here. A `terraform apply` that touches one of those
# task defs registers a revision carrying the `:latest` floor again — that is
# the documented handover, and the next deploy re-pins it (see ecs.tf).
#
# Usage:  pin-ecs-task-image.sh <family> <image>
#         pin-ecs-task-image.sh --self-test
set -euo pipefail

# The one piece of real logic: strip the read-only fields describe returns and
# register cannot accept, and swap the image. Kept as a named filter so
# --self-test can run it without AWS. Adding a field to ECS's *output* and not
# to this list is the failure mode, and it fails loudly (register rejects the
# unknown key) rather than silently.
readonly PIN_FILTER='
  if (.containerDefinitions | length) != 1 then
    error("expected exactly 1 container, got \(.containerDefinitions | length)")
  else . end
  | del(
      .taskDefinitionArn, .revision, .status, .requiresAttributes,
      .compatibilities, .registeredAt, .registeredBy, .deregisteredAt
    )
  | .containerDefinitions[0].image = $img
'

self_test() {
  local out
  # A trimmed but real describe-task-definition shape, including every
  # read-only field the filter has to drop.
  out=$(jq --arg img "repo/app:abc123" "$PIN_FILTER" <<'JSON'
{
  "taskDefinitionArn": "arn:aws:ecs:ap-southeast-2:1:task-definition/f:3",
  "revision": 3,
  "status": "ACTIVE",
  "requiresAttributes": [{"name": "ecs.capability.execution-role-awslogs"}],
  "compatibilities": ["EC2", "FARGATE"],
  "registeredAt": "2026-08-01T00:00:00+00:00",
  "registeredBy": "arn:aws:sts::1:assumed-role/x/y",
  "family": "f",
  "cpu": "1024",
  "memory": "4096",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "executionRoleArn": "arn:aws:iam::1:role/exec",
  "taskRoleArn": "arn:aws:iam::1:role/task",
  "containerDefinitions": [{"name": "c", "image": "repo/app:latest", "essential": true}]
}
JSON
)
  local fails=0
  check() { # check <description> <jq test expression>
    if [ "$(jq -r "$2" <<<"$out")" = "true" ]; then
      echo "ok   — $1"
    else
      echo "FAIL — $1"; fails=1
    fi
  }
  check "image is pinned to the requested tag" '.containerDefinitions[0].image == "repo/app:abc123"'
  check "container name and essential survive"  '.containerDefinitions[0].name == "c" and .containerDefinitions[0].essential'
  check "roles survive"                          '.executionRoleArn != null and .taskRoleArn != null'
  check "sizing and network survive"             '.cpu == "1024" and .memory == "4096" and .networkMode == "awsvpc"'
  check "every read-only field is dropped" '
    ([.taskDefinitionArn, .revision, .status, .requiresAttributes,
      .compatibilities, .registeredAt, .registeredBy, .deregisteredAt]
     | all(. == null))'

  # A multi-container def must abort rather than have both images rewritten.
  if jq --arg img x "$PIN_FILTER" <<<'{"containerDefinitions":[{},{}]}' >/dev/null 2>&1; then
    echo "FAIL — a 2-container task definition was accepted"; fails=1
  else
    echo "ok   — a 2-container task definition is refused"
  fi

  [ "$fails" -eq 0 ] || { echo "self-test failed"; exit 1; }
  echo "self-test passed"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit 0
fi

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <task-definition-family> <image>" >&2
  exit 2
fi
family="$1"
image="$2"

current=$(aws ecs describe-task-definition --task-definition "$family" \
  --query 'taskDefinition' --output json)
updated=$(jq --arg img "$image" "$PIN_FILTER" <<<"$current")

arn=$(aws ecs register-task-definition --cli-input-json "$updated" \
  --query 'taskDefinition.taskDefinitionArn' --output text)
echo "Registered $arn"

# The registration is only useful if it is what RunTask will pick up, so assert
# it rather than assume it: resolve the family the same way RunTask does and
# check both the revision and the image. A concurrent deploy registering after
# us would show up here as a mismatch instead of as a worker quietly running
# someone else's build.
live=$(aws ecs describe-task-definition --task-definition "$family" \
  --query 'taskDefinition.[taskDefinitionArn,containerDefinitions[0].image]' --output text)
live_arn=$(cut -f1 <<<"$live")
live_image=$(cut -f2 <<<"$live")
if [ "$live_arn" != "$arn" ] || [ "$live_image" != "$image" ]; then
  echo "::error::$family resolves to $live_arn ($live_image), not the revision just registered ($arn, $image)"
  exit 1
fi
echo "$family -> $live_arn pinned to $image"
