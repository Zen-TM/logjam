# shellcheck shell=bash
# Sourced by the other host scripts. Reads /etc/brain/brain.env and points
# Compose at the brain's files. AWS_ENDPOINT_URL and AWS_ACCESS_KEY_ID, if set
# there, are what s3_curl uses: the end-to-end test points them at a local stand-in.
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
# boot.sh's marker, kept on the data volume from before a Postgres major upgrade until a full backup of the
# new major succeeds: release-agent.sh starts no API while it exists.
export gate=/data/brain/backup-pending

# s3_get <key>: the object on stdout, from the signals bucket. s3_put <key>: stdin to the object.
# curl, not the aws CLI: the timers call these three times a minute, and a CLI start costs 66 MB
# and 0.65 s of CPU on a t4g.micro (these: 18 MB, 0.10 s). Guard: tests/e2e.sh (a tick never starts `aws`).
s3_get() { s3_curl "$1"; }
s3_put() { s3_curl "$1" -X PUT --data-binary @-; }

# s3_curl <key> [curl args]: one signed request. The instance role's credentials are read from
# metadata on every call and reach curl as a config on a pipe: never on disk, never in an argument
# list where ps shows it. The payload is unsigned (TLS protects it). A 4xx or 5xx exits non-zero
# with the status on stderr and the body unread.
s3_curl() {
  local key=$1 k s t='' url
  shift
  if [ -n "${AWS_ACCESS_KEY_ID:-}" ]; then
    k=$AWS_ACCESS_KEY_ID s=${AWS_SECRET_ACCESS_KEY:-} t=${AWS_SESSION_TOKEN:-}
  else
    { read -r k && read -r s && read -r t; } < <(role_credentials) || { log "no credentials from instance metadata"; return 1; }
  fi
  url=https://$BRAIN_SIGNALS_BUCKET.s3.$AWS_REGION.amazonaws.com/$key
  [ -z "${AWS_ENDPOINT_URL:-}" ] || url=$AWS_ENDPOINT_URL/$BRAIN_SIGNALS_BUCKET/$key
  curl -fsS --connect-timeout 5 -m 20 --aws-sigv4 "aws:amz:$AWS_REGION:s3" -H 'x-amz-content-sha256: UNSIGNED-PAYLOAD' \
    -K <(printf 'user = "%s:%s"\nheader = "x-amz-security-token: %s"\n' "$k" "$s" "$t") "$@" "$url"
}

# AccessKeyId, SecretAccessKey and Token of the instance role, one per line (IMDSv2).
role_credentials() {
  python3 - "${BRAIN_IMDS_URL:-http://169.254.169.254}/latest/" <<'PY'
import json, sys, urllib.request as u
base = sys.argv[1]
token = u.urlopen(u.Request(base + "api/token", method="PUT", headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"}), timeout=3).read().decode()
get = lambda path: u.urlopen(u.Request(base + "meta-data/iam/security-credentials/" + path, headers={"X-aws-ec2-metadata-token": token}), timeout=3).read().decode()
c = json.loads(get(get("").split()[0]))
print(c["AccessKeyId"], c["SecretAccessKey"], c["Token"], sep="\n")
PY
}

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

# Run in the Postgres container. pgb runs pgBackRest and psql_agent psql as
# the OS user postgres, which connects to Postgres as brain_agent (agent.sql):
# the scheduled jobs. psql_super is the superuser, over the local socket, for
# boot.sh's one-time setup only.
pg_cid() { compose ps -q postgres; }
pgb() { docker exec -u postgres "$(pg_cid)" pgbackrest --stanza=logjam "$@"; }
psql_agent() { docker exec -i -u postgres "$(pg_cid)" psql -U brain_agent -d postgres -X -q -tA -v ON_ERROR_STOP=1 "$@"; }
psql_super() { docker exec -i -u postgres "$(pg_cid)" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
