#!/usr/bin/env bash
# Wraps the official entrypoint. A data directory with no database is only
# filled on purpose: BRAIN_INIT=bootstrap makes one, BRAIN_INIT=restore
# restores the latest backup, anything else stops. Otherwise a volume that
# failed to mount would come up empty and look healthy.
set -Eeuo pipefail
export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
. /usr/local/lib/brain/brain-lib.sh

as_pg() { if [ "$(id -u)" = 0 ]; then gosu postgres "$@"; else "$@"; fi; }

if [ "${1:-}" = postgres ]; then
  shift
  set -- postgres -c config_file=/etc/postgresql/postgresql.conf "$@"
fi

if [ "${BRAIN_DEV:-}" = 1 ] && [ -z "${BRAIN_BACKUP_BUCKET:-}" ]; then
  : # dev keeps its database off S3 (archive_mode=off in docker-compose.yml)
else
  umask 027
  /usr/local/lib/brain/pgbackrest-conf.sh > /etc/pgbackrest/pgbackrest.conf
  chgrp postgres /etc/pgbackrest/pgbackrest.conf 2>/dev/null || true
fi

BOOTSTRAP_CONF=/var/run/postgresql/brain-bootstrap.conf
rm -f "$BOOTSTRAP_CONF"
mkdir -p "$PGDATA"
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  case "${BRAIN_INIT:-}" in
    bootstrap)
      printf "ssl = off\narchive_mode = off\n" > "$BOOTSTRAP_CONF"; chown postgres:postgres "$BOOTSTRAP_CONF"
      export POSTGRES_INITDB_ARGS="--data-checksums ${POSTGRES_INITDB_ARGS:-}" ;;
    restore)
      chown postgres:postgres "$PGDATA"; chmod 0700 "$PGDATA"
      as_pg pgbackrest --stanza=logjam restore ;;
    *)
      echo "brain-entrypoint: $PGDATA has no database and BRAIN_INIT is '${BRAIN_INIT:-}', not bootstrap or restore: refusing to create one" >&2
      exit 1 ;;
  esac
fi

# A volume made by the stock image has no certificate; dev adds one.
# Prod fails to start instead, which is the safe way to find out.
if [ -s "$PGDATA/PG_VERSION" ]; then
  as_pg bash -c '. /usr/local/lib/brain/brain-lib.sh
    brain_install_hba
    [ "${BRAIN_DEV:-}" = 1 ] && [ ! -e "$PGDATA/server.crt" ] && brain_gen_cert || true'
fi

exec docker-entrypoint.sh "$@"
