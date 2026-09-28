#!/usr/bin/env bash
# Repin every ECS task definition that runs one image repository's images.
#
# The one declaration of which task-definition families run which image: the
# deploy workflows, rollback.yml, deploy-guard.yml (the worker's live release
# is its first family's tag) and docs/operations/rollback.md all go through
# this script. A family added to one list and not another would be left on the
# wrong image by a deploy or a rollback. --self-test checks the list against
# the families infra/terraform/envs/prod/ecs.tf defines.
#
# Usage:  pin-release.sh <image>              e.g. <registry>/logjam-api:<sha>
#         pin-release.sh --families <repo>    print the families, one per line
#         pin-release.sh --self-test
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

families() {
  case "$1" in
    logjam-api) echo logjam-api-migrate logjam-geo-pdf-worker ;;
    logjam-topo-worker) echo logjam-topo-worker logjam-topo-export-worker ;;
    *) echo "unknown image repository '$1'" >&2; return 1 ;;
  esac
}

self_test() {
  # "repo family" pairs from ecs.tf: each task definition names its image
  # before its family.
  local want got
  want=$(awk '
    /image *=/ { match($0, /\/[a-z0-9-]+:/); repo = substr($0, RSTART + 1, RLENGTH - 2) }
    /^ *family *=/ { gsub(/[" ]/, "", $3); print repo, $3 }
  ' "$HERE/../terraform/envs/prod/ecs.tf" | LC_ALL=C sort)
  got=$(for repo in logjam-api logjam-topo-worker; do
    for family in $(families "$repo"); do echo "$repo $family"; done
  done | LC_ALL=C sort)
  if [ -z "$want" ]; then
    echo "FAIL — found no task definitions in ecs.tf"; return 1
  fi
  if [ "$want" != "$got" ]; then
    echo "FAIL — families here differ from ecs.tf"
    diff <(echo "$want") <(echo "$got") | sed 's/^/  /'
    return 1
  fi
  echo "ok   — families match ecs.tf:"
  sed 's/^/       /' <<<"$want"
}

case "${1:-}" in
  --self-test) self_test ;;
  --families) families "${2:?repo}" | tr ' ' '\n' ;;
  "" | -*) echo "usage: $0 <image> | --families <repo> | --self-test" >&2; exit 2 ;;
  *)
    image=$1
    repo=${image##*/}
    repo=${repo%%:*}
    for family in $(families "$repo"); do
      "$HERE/pin-ecs-task-image.sh" "$family" "$image"
    done
    ;;
esac
