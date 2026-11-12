#!/usr/bin/env bash
# Every 30 s (and at the end of boot.sh): make the running API match the
# switch and the signals bucket. Serving off: no API container. On: the release
# pointer's image and environment. It does not judge health or roll back: CI's
# smoke job and rollback.yml rewrite the pointer. Guard: tests/e2e.sh.
. "$(dirname "$0")/lib.sh"
exec 9> /run/brain-release.lock
flock -n 9 || exit 0
export COMPOSE_PROFILES=api

if [ "$(serving_state)" != on ]; then
  compose rm -sf api
  exit 0
fi

# boot.sh's marker: no full backup of the database's Postgres major yet.
[ ! -e /data/brain/backup-pending ] || { log "not starting the API: no full backup of this Postgres major yet"; exit 0; }

release=$(s3_get release.json) || die "serving is on but release.json cannot be read: changing nothing"

# The file is rendered from the release's env, then the host's own line goes
# LAST: a later duplicate wins in an env_file, so no release can unset it.
# Values are single-quoted so Compose does not interpolate them, which is also
# why a quote or a backslash in one refuses the release.
new=$(mktemp /etc/brain/api.env.XXXXXX)
trap 'rm -f "$new"' EXIT
sha=$(RELEASE=$release python3 - "$new" <<'PY'
import json, os, re, sys
r = json.loads(os.environ["RELEASE"])
sha, env = r["sha"], r["env"]
assert re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", sha), "bad sha"
with open(sys.argv[1], "w") as f:
    for k, v in env.items():
        assert re.fullmatch(r"[A-Z][A-Z0-9_]*", k), "bad name"
        assert isinstance(v, str) and not re.search(r"[\x00-\x1f\x7f'\\]", v), "bad value for " + k
        f.write(f"{k}='{v}'\n")
    f.write("LOGJAM_RUNTIME=prod\n")
print(sha)
PY
) || die "release.json is not a usable release: changing nothing"

changed=
cmp -s "$new" /etc/brain/api.env 2> /dev/null || changed=1
export BRAIN_API_TAG=$sha
cid=$(compose ps -aq api)
if [ -z "$changed" ] && [ -n "$cid" ] \
  && [ "$(docker inspect -f '{{.Config.Image}}' "$cid")" = "$BRAIN_API_REPO:$sha" ] \
  && [[ "$(docker inspect -f '{{.State.Status}}' "$cid")" =~ ^(running|restarting)$ ]]; then
  exit 0
fi
chmod 0600 "$new"
mv "$new" /etc/brain/api.env
# --no-deps: only boot.sh starts Postgres. The pull comes first so the old container is not stopped
# while a layer downloads (tags are immutable: an image that is here is not pulled again).
# A failed pull or `up` takes the new file away again, or the next run would see nothing to change.
{ compose pull -q --policy missing api && compose up -d --no-deps --force-recreate api; } || { rm -f /etc/brain/api.env; die "the API did not start at $sha: the next run tries again"; }
# Old releases would fill the root disk. Images of containers are kept; a rollback pulls an old one again.
docker image prune -af --filter until=72h > /dev/null || true
