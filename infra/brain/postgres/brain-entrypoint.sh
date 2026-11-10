#!/usr/bin/env bash
# Wraps the official entrypoint. A server start on a data directory with no
# database only fills it on purpose: BRAIN_INIT=bootstrap makes one,
# BRAIN_INIT=restore restores the latest backup (or the time in BRAIN_RESTORE_TARGET),
# anything else stops.
# Otherwise a volume that failed to mount would come up empty and look healthy.
# Any other command (`pgbackrest info`, `bash`, `postgres --version`) skips
# all that and runs as given.
set -Eeuo pipefail
export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
. /usr/local/lib/brain/brain-lib.sh

as_pg() { if [ "$(id -u)" = 0 ]; then gosu postgres "$@"; else "$@"; fi; }

# As the official entrypoint does: leading flags mean `postgres <flags>`.
case "${1:-}" in -*) set -- postgres "$@" ;; esac

server=0
if [ "${1:-}" = postgres ]; then
  server=1
  for arg in "$@"; do
    case $arg in -'?' | --help | --describe-config | -V | --version) server=0 ;; esac
  done
fi
# Whatever the server is started with, it reads postgresql.conf.
if [ "$server" = 1 ]; then
  shift
  set -- postgres -c config_file=/etc/postgresql/postgresql.conf "$@"
fi

# Rendered for every command, so `pgbackrest info` through this image reads
# the same repository the server writes. Dev's server runs without a bucket.
if [ -n "${BRAIN_BACKUP_BUCKET:-}" ] || { [ "$server" = 1 ] && [ "${BRAIN_DEV:-}" != 1 ]; }; then
  umask 027
  /usr/local/lib/brain/pgbackrest-conf.sh > /etc/pgbackrest/pgbackrest.conf
  chgrp postgres /etc/pgbackrest/pgbackrest.conf 2>/dev/null || true
fi

if [ "$server" = 1 ]; then
  BOOTSTRAP_CONF=/var/run/postgresql/brain-bootstrap.conf
  rm -f "$BOOTSTRAP_CONF"
  mkdir -p "$PGDATA"
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    case "${BRAIN_INIT:-}" in
      bootstrap)
        printf "ssl = off\narchive_mode = off\n" > "$BOOTSTRAP_CONF"
        [ "$(id -u)" != 0 ] || chown postgres:postgres "$BOOTSTRAP_CONF"
        export POSTGRES_INITDB_ARGS="--data-checksums ${POSTGRES_INITDB_ARGS:-}" ;;
      restore)
        # PGDATA must be empty, so the host mounts a subdirectory of its data
        # volume here, never the filesystem's own mount point (lost+found).
        if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$PGDATA"; fi
        chmod 0700 "$PGDATA"
        # BRAIN_RESTORE_TARGET (the host checked it is an RFC 3339 time with an offset): stop at
        # that time, in the form pgBackRest takes (a space for the T, +00 for Z). Without
        # --target-action=promote recovery pauses at the target and never opens for writes.
        # Every restore follows the timeline its backup was taken on. Postgres's own default
        # follows the newest timeline in the archive, which after a rewind is a branch the
        # backup may never have been on. Guard: tests/test.sh, tests/e2e.sh scenario 13.
        target=(--target-timeline=current)
        if [ -n "${BRAIN_RESTORE_TARGET:-}" ]; then
          t=${BRAIN_RESTORE_TARGET/T/ }
          target+=(--type=time "--target=${t/%Z/+00}" --target-action=promote)
        fi
        # BRAIN_RESTORE_OPTS, unquoted so it splits into options: extra pgbackrest restore
        # options, such as --archive-mode=off. Nothing in production sets it; the drill runs
        # pgbackrest itself (postgres/drill.sh).
        # shellcheck disable=SC2086
        as_pg pgbackrest --stanza=logjam restore "${target[@]}" ${BRAIN_RESTORE_OPTS:-} ;;
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
fi

exec docker-entrypoint.sh "$@"
