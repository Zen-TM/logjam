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

# tag_value <tag> <test file>: an instance tag, read from the metadata service.
# Empty when the tag is missing or unreadable. Test-only: a non-empty file name
# is read instead (BRAIN_SERVING_FILE, BRAIN_BOOTSTRAP_FILE), and BRAIN_IMDS_URL
# moves the metadata service. Guard: tests/e2e.sh.
tag_value() {
  local imds=${BRAIN_IMDS_URL:-http://169.254.169.254} token
  if [ -n "${2:-}" ]; then
    cat "$2" 2> /dev/null || true
  elif token=$(curl -sf -m 3 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' "$imds/latest/api/token"); then
    curl -sf -m 3 -H "X-aws-ec2-metadata-token: $token" "$imds/latest/meta-data/tags/instance/$1" || true
  fi
}

# Two switches, each exactly one value or no: anything unexpected is no.
# brain-serving=on lets the API run; brain-bootstrap=1 lets boot.sh run initdb.
serving_state() { if [ "$(tag_value brain-serving "${BRAIN_SERVING_FILE:-}" | tr -d '[:space:]')" = on ]; then echo on; else echo off; fi; }
bootstrap_allowed() { [ "$(tag_value brain-bootstrap "${BRAIN_BOOTSTRAP_FILE:-}" | tr -d '[:space:]')" = 1 ]; }

# s3_put <key>: stdin to the object.
s3_put() { aws s3 cp - "s3://$BRAIN_SIGNALS_BUCKET/$1" --only-show-errors; }

# Run in the Postgres container. pgb runs pgBackRest and psql_agent psql as
# the OS user postgres, which connects to Postgres as brain_agent (agent.sql):
# the scheduled jobs. psql_super is the superuser, over the local socket, for
# boot.sh's one-time setup only.
pg_cid() { compose ps -q postgres; }
pgb() { docker exec -u postgres "$(pg_cid)" pgbackrest --stanza=logjam "$@"; }
psql_agent() { docker exec -i -u postgres "$(pg_cid)" psql -U brain_agent -d postgres -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
psql_super() { docker exec -i -u postgres "$(pg_cid)" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
