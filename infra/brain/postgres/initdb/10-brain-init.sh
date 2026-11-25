#!/usr/bin/env bash
# Runs once, as postgres, on bootstrap only (the official entrypoint skips
# /docker-entrypoint-initdb.d for an existing database). Prod's roles are
# not made here.
set -Eeuo pipefail
. /usr/local/lib/brain/brain-lib.sh

brain_gen_cert
brain_install_hba
rm -f /var/run/postgresql/brain-bootstrap.conf

# template1 so a database made later has it; POSTGRES_DB already exists.
for db in template1 "$POSTGRES_DB"; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" \
    -c 'CREATE EXTENSION IF NOT EXISTS pgaudit'
done
