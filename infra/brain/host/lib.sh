# shellcheck shell=bash
# Sourced by the other host scripts. Reads /etc/brain/brain.env and points
# Compose at the brain's files. AWS_ENDPOINT_URL, if set there, is honoured by
# the aws CLI: the end-to-end test points it at a local stand-in.
set -euo pipefail

# Not `source`: the file is KEY=value, and a value may hold spaces (BRAIN_PG_FLAGS).
while IFS= read -r line; do
  case $line in ''|'#'*) ;; *) export "${line%%=*}=${line#*=}" ;; esac
done < /etc/brain/brain.env
: "${AWS_REGION:?}" "${BRAIN_DATA_DEVICE:?}" "${BRAIN_SIGNALS_BUCKET:?}" "${BRAIN_BACKUP_BUCKET:?}"
export AWS_DEFAULT_REGION=$AWS_REGION

export COMPOSE_PROJECT_NAME=brain
files=/opt/brain/compose.yaml
if [ -n "${BRAIN_LOG_GROUP_API:-}${BRAIN_LOG_GROUP_PG:-}" ]; then
  if [ -z "${BRAIN_LOG_GROUP_API:-}" ] || [ -z "${BRAIN_LOG_GROUP_PG:-}" ]; then
    echo "brain: set both BRAIN_LOG_GROUP_API and BRAIN_LOG_GROUP_PG or neither" >&2; exit 1
  fi
  files+=:/opt/brain/compose.aws.yaml
fi
# Test-only: one more Compose file (the end-to-end test's local-S3 plumbing).
export COMPOSE_FILE=$files${BRAIN_COMPOSE_EXTRA:+:$BRAIN_COMPOSE_EXTRA}
unset files line

log() { echo "brain: $*" >&2; }
die() { log "$*"; exit 1; }
compose() { docker compose "$@"; }

# s3_get <key>: the object on stdout. Returns 2 when the key does not exist and
# 1 when it could not be read, so callers can tell "off" from "unreachable".
s3_get() {
  local err rc=0
  err=$(mktemp)
  aws s3 cp "s3://$BRAIN_SIGNALS_BUCKET/$1" - 2>"$err" || rc=$?
  if [ "$rc" != 0 ]; then
    if grep -qE '\(404\)|NoSuchKey|does not exist' "$err"; then rc=2; else cat "$err" >&2; rc=1; fi
  fi
  rm -f "$err"
  return "$rc"
}

# s3_put <key>: stdin to the object.
s3_put() { aws s3 cp - "s3://$BRAIN_SIGNALS_BUCKET/$1" --only-show-errors; }

# Run in the Postgres container. pgb runs pgBackRest as postgres, psql_super
# is the one superuser connection (local socket, peer): boot.sh only.
pg_cid() { compose ps -q postgres; }
pgb() { docker exec -u postgres "$(pg_cid)" pgbackrest --stanza=logjam "$@"; }
psql_super() { docker exec -i -u postgres "$(pg_cid)" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
