#!/usr/bin/env bash
# Prints pgbackrest.conf from the environment. Every pgBackRest-specific line
# of the image is here, plus archive_command in postgresql.conf and the
# restore call in brain-entrypoint.sh.
set -euo pipefail

echo "[global]"
echo "repo1-type=s3"
echo "repo1-path=/logjam"
echo "repo1-s3-bucket=${BRAIN_BACKUP_BUCKET:?}"
echo "repo1-s3-region=${AWS_REGION:?}"
if [ -n "${BRAIN_BACKUP_ENDPOINT:-}" ]; then
  echo "repo1-s3-endpoint=${BRAIN_BACKUP_ENDPOINT}"
  echo "repo1-s3-uri-style=path"
else
  echo "repo1-s3-endpoint=s3.${AWS_REGION}.amazonaws.com"
fi
# Only so a test can use an S3 stand-in with a self-signed certificate. Never
# against real S3, so it needs an explicit endpoint.
if [ "${BRAIN_BACKUP_VERIFY_TLS:-y}" = n ]; then
  [ -n "${BRAIN_BACKUP_ENDPOINT:-}" ] || { echo "pgbackrest-conf: BRAIN_BACKUP_VERIFY_TLS=n needs BRAIN_BACKUP_ENDPOINT: it is for test stand-ins, never real S3" >&2; exit 1; }
  echo "repo1-storage-verify-tls=n"
fi
if [ -n "${AWS_ACCESS_KEY_ID:-}" ]; then
  echo "repo1-s3-key-type=shared"
  echo "repo1-s3-key=${AWS_ACCESS_KEY_ID}"
  echo "repo1-s3-key-secret=${AWS_SECRET_ACCESS_KEY:?}"
  [ -z "${AWS_SESSION_TOKEN:-}" ] || echo "repo1-s3-token=${AWS_SESSION_TOKEN}"
else
  echo "repo1-s3-key-type=auto"
fi
echo "compress-type=zst"
echo "repo1-bundle=y"
echo "start-fast=y"
echo "repo1-retention-full=8"
echo "archive-push-queue-max=${BRAIN_ARCHIVE_QUEUE_MAX:-8GiB}"
echo "process-max=1"
echo "log-level-console=warn"
echo
echo "[logjam]"
echo "pg1-path=${PGDATA}"
# The role that backups connect as, over the local socket (prod: brain_agent).
[ -z "${BRAIN_BACKUP_PG_USER:-}" ] || echo "pg1-user=${BRAIN_BACKUP_PG_USER}"
