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

# s3_get <key>: the object on stdout, from the signals bucket.
s3_get() { aws s3 cp "s3://$BRAIN_SIGNALS_BUCKET/$1" - --only-show-errors; }

# The serving switch, "on" or "off": the instance tag brain-serving, read from
# the metadata service. Anything unexpected is off: no tag, another value, no
# answer. Test-only: BRAIN_SERVING_FILE names a file to read instead, and
# BRAIN_IMDS_URL moves the metadata service. Guard: tests/e2e.sh.
serving_state() {
  local imds=${BRAIN_IMDS_URL:-http://169.254.169.254} token value=
  if [ -n "${BRAIN_SERVING_FILE:-}" ]; then
    value=$(cat "$BRAIN_SERVING_FILE" 2> /dev/null || true)
  elif token=$(curl -sf -m 3 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' "$imds/latest/api/token"); then
    value=$(curl -sf -m 3 -H "X-aws-ec2-metadata-token: $token" "$imds/latest/meta-data/tags/instance/brain-serving" || true)
  fi
  if [ "$(tr -d '[:space:]' <<<"$value")" = on ]; then echo on; else echo off; fi
}

# s3_put <key>: stdin to the object.
s3_put() { aws s3 cp - "s3://$BRAIN_SIGNALS_BUCKET/$1" --only-show-errors; }

# Run in the Postgres container. pgb runs pgBackRest as postgres, psql_super
# is the one superuser connection (local socket, peer): boot.sh only.
pg_cid() { compose ps -q postgres; }
pgb() { docker exec -u postgres "$(pg_cid)" pgbackrest --stanza=logjam "$@"; }
psql_super() { docker exec -i -u postgres "$(pg_cid)" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
