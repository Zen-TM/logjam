#!/usr/bin/env bash
# Checks that /start launched the job's worker through ECS RunTask, then prints
# the worker container's id. Mutation that turns it red: unset ECS_SUBNETS for
# the API; /start then skips RunTask and the row has no task ARN.
# Needs the job env's PGPASSWORD and AWS settings, and $ECS_CLUSTER, $NET.
# Usage: ecs-worker.sh <job id>
set -euo pipefail

id=$1
fail() { echo "$*" >&2; exit 1; }

arn=$(psql -h localhost -U logjam -d logjam -tAc "SELECT coalesce(ecs_task_arn, '') FROM topo_jobs WHERE id = '$id'")
[ -n "$arn" ] || fail "job $id has no ecs_task_arn: /start did not call RunTask"

# MiniStack's own record of the task, not just the API's copy of the ARN.
aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$arn" \
  | jq -e '.tasks[0].taskDefinitionArn | test("task-definition/logjam-topo-worker:")' >&2 \
  || fail "MiniStack has no logjam-topo-worker task $arn"

# The container starts a moment after RunTask returns.
cid=
for _ in $(seq 1 60); do
  cid=$(docker ps -aq --filter "label=com.amazonaws.ecs.task-arn=$arn")
  [ -n "$cid" ] && break
  sleep 2
done
[ -n "$cid" ] || fail "MiniStack never started a container for $arn"

# The override the API passed must have reached the container, and MiniStack
# must have put it on the no-internet network (it takes its own first network,
# by name: see "A network with no internet" in ci.yml).
docker inspect "$cid" | jq -e --arg id "$id" --arg net "$NET" \
  '.[0] as $c | ($c.Config.Env | index("JOB_ID=" + $id)) != null
     and ($c.NetworkSettings.Networks | keys) == [$net]' >&2 \
  || fail "container $cid lacks JOB_ID=$id or is not only on $NET"
echo "$cid"
