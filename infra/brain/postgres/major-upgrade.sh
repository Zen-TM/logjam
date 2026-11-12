#!/usr/bin/env bash
# Upgrades the brain's database to this image's major version, as a one-off
# container (compose.yaml's `upgrade` service, run by host/boot.sh) with the
# host's /data mounted at /data. It has to see /data, not only the cluster in
# it, because the swap renames directories. Run as root.
#
#   /data/postgres       the cluster, the only path the server mounts
#   /data/postgres.new   the upgraded copy, until the swap
#   /data/postgres-<N>   the old cluster, kept for good: it is the rollback
#
# Nothing is deleted except a /data/postgres.new this script left unfinished.
# pg_upgrade runs in copy mode, never --link: a linked old cluster would stop
# being a rollback the moment the new one ran. Stdout is one line, `upgraded <old> -> <new>`,
# or nothing when the cluster is already at this major; everything else is stderr.
# BRAIN_UPGRADE_MARGIN: free bytes wanted beyond the old cluster's size (default 1 GiB).
# Guard: tests/test.sh ("major upgrade"), tests/e2e.sh scenario 14.
set -Eeuo pipefail

DATA=/data
cur=$DATA/postgres
tmp=$DATA/postgres.new
new=${PG_MAJOR:?}
newbin=/usr/lib/postgresql/$new/bin

say() { echo "major-upgrade: $*" >&2; }
fail() { say "$*"; exit 1; }
as_pg() { gosu postgres "$@"; }
major() { { cat "$1/PG_VERSION" 2> /dev/null || true; } | tr -d '[:space:]'; }
number() { [[ ${1:-} =~ ^[0-9]+$ ]]; }

[ "$(id -u)" = 0 ] || fail "run as root"
old=$(major "$cur")
number "$old" || fail "$cur holds no database"
aside=$(major "$tmp")

if [ "$old" = "$new" ]; then
  # A crash between the swap and the last rename leaves the new cluster in place and the old one
  # under the temporary name: finish that, as the only thing left to do.
  if number "$aside" && [ "$aside" -lt "$new" ]; then
    [ ! -e "$DATA/postgres-$aside" ] || fail "$DATA/postgres-$aside exists already: not renaming $tmp over it"
    mv "$tmp" "$DATA/postgres-$aside"
    sync
    echo "upgraded $aside -> $new"
  fi
  exit 0
fi

[ "$old" -lt "$new" ] || fail "the data is PostgreSQL $old and this image runs $new: refusing. Restoring from before an upgrade needs the image of that time."
oldbin=/usr/lib/postgresql/$old/bin
[ -x "$oldbin/pg_ctl" ] || fail "this image has no PostgreSQL $old binaries, so it cannot read the data"
[ ! -e "$DATA/postgres-$old" ] || fail "$DATA/postgres-$old exists already: not making it a second time"

# What an unfinished run of this script left, and only that: a new cluster of this image's
# major, or an empty directory. Anything else under the name is not ours to delete.
if [ -e "$tmp" ]; then
  { [ -z "$aside" ] || [ "$aside" = "$new" ]; } || fail "$tmp holds a PostgreSQL ${aside} cluster that is not an unfinished upgrade: not deleting it"
  say "removing the unfinished $tmp of an earlier run"
  rm -rf "$tmp"
fi

# Copy mode doubles the cluster.
used=$(du -sb "$cur" | cut -f1)
free=$(df -B1 --output=avail "$DATA" | tail -1 | tr -dc 0-9)
margin=${BRAIN_UPGRADE_MARGIN:-1073741824}
[ "$free" -ge $((used + margin)) ] || fail "$free bytes free on $DATA, and the copy needs the cluster's $used plus $margin: not upgrading"

work=$(mktemp -d)
chown postgres:postgres "$work"
running=
stop_old() { [ -z "$running" ] || as_pg "$oldbin/pg_ctl" -D "$cur" -m fast -w stop > /dev/null 2>&1 || true; running=; }
trap 'stop_old; rm -rf "$work"' EXIT

# One start of the old server, with no listener and no archiving: crash recovery if its last
# shutdown was not clean, and the settings the new cluster must repeat. archive_mode=off keeps it
# from ever pushing WAL into the live repository (the new cluster gets its own stanza).
ctl() { LC_ALL=C as_pg "$oldbin/pg_controldata" "$cur" | sed -n "s/^$1: *//p"; }
say "starting the PostgreSQL $old cluster once (state: $(ctl 'Database cluster state'))"
as_pg "$oldbin/pg_ctl" -D "$cur" -w -t 3600 -l "$work/old.log" -o "-c listen_addresses= -c archive_mode=off -c unix_socket_directories=$work" start > /dev/null \
  || { tail -20 "$work/old.log" >&2; fail "the PostgreSQL $old cluster does not start"; }
running=1
IFS='|' read -r su enc collate ctype provider < <(as_pg "$oldbin/psql" -h "$work" -U postgres -d template1 -X -tAq -F '|' -c \
  "select (select rolname from pg_authid where oid = 10), pg_encoding_to_char(encoding), datcollate, datctype, datlocprovider from pg_database where datname = 'template1'")
stop_old
# pg_upgrade connects as the OS user, so the cluster's superuser must be the brain's `postgres`.
[ "$su" = postgres ] || fail "the cluster's superuser is '$su', not postgres: not upgrading it"
[ "$provider" = c ] || fail "the cluster's locale provider is '$provider', not libc: not upgrading it"

[ "$(ctl 'Database cluster state')" = "shut down" ] || fail "the PostgreSQL $old cluster is still not shut down cleanly"
sums=--no-data-checksums; [ "$(ctl 'Data page checksum version')" = 0 ] || sums=--data-checksums
mkdir "$tmp"
chown postgres:postgres "$tmp"
chmod 0700 "$tmp"
as_pg "$newbin/initdb" -D "$tmp" --username=postgres --encoding="$enc" --lc-collate="$collate" --lc-ctype="$ctype" \
  --locale-provider=libc "$sums" --wal-segsize="$(($(ctl 'Bytes per WAL segment') / 1048576))" --auth-local=trust --auth-host=reject > /dev/null

# pgaudit is in both servers' shared_preload_libraries when pg_upgrade loads the libraries the
# old catalogs name; the brain's databases have the extension. pg_upgrade starts the old server
# itself, so archiving is off for it too.
upgrade() { (cd "$work" && as_pg "$newbin/pg_upgrade" -b "$oldbin" -B "$newbin" -d "$cur" -D "$tmp" --socketdir="$work" --copy \
  --old-options="-c shared_preload_libraries=pgaudit -c archive_mode=off" --new-options="-c shared_preload_libraries=pgaudit" "$@") >&2; }
upgrade --check
upgrade

# What lives in the data directory and is not the cluster: the certificate the API pins (a new one
# would break every connection), and ALTER SYSTEM settings. A restore's recovery settings are
# not carried: they name the old stanza and mean nothing outside a recovery. pg_hba.conf and
# pg_ident.conf are written by brain-entrypoint.sh at every start.
for f in server.crt server.key; do
  [ ! -e "$cur/$f" ] || cp -p "$cur/$f" "$tmp/$f"
done
{ grep -Ev '^(#|restore_command|recovery_|archive_cleanup_command|primary_)' "$cur/postgresql.auto.conf" || true; } >> "$tmp/postgresql.auto.conf"

sync
mv -T --exchange "$cur" "$tmp"
mv "$tmp" "$DATA/postgres-$old"
sync
echo "upgraded $old -> $new"
