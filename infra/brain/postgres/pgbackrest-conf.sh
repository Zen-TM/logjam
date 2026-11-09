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
if [ -n "${AWS_ACCESS_KEY_ID:-}" ]; then
  echo "repo1-s3-key-type=shared"
  echo "repo1-s3-key=${AWS_ACCESS_KEY_ID}"
  echo "repo1-s3-key-secret=${AWS_SECRET_ACCESS_KEY:?}"
else
  echo "repo1-s3-key-type=auto"
fi
echo "compress-type=zst"
echo "repo1-retention-full=8"
echo "archive-push-queue-max=${BRAIN_ARCHIVE_QUEUE_MAX:-4GiB}"
echo "process-max=1"
echo "log-level-console=warn"
echo
echo "[logjam]"
echo "pg1-path=${PGDATA}"
