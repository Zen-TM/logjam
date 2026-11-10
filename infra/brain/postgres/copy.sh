#!/usr/bin/env bash
# The cutover's data copy, run by hand as the container's command of a one-off
# task: dump `public` from the source (RDS) to a file, restore it into the
# brain in one transaction, check the result. Exit 0 only when every check
# held. It is also the dress rehearsal, run against the dormant brain.
#
# It never runs against a serving brain (a copy would replace live data with
# the source's frozen one): status.json in the signals bucket must be fresh and
# say serving is false, and an unreadable or stale file stops it. Both ends are
# connected with full certificate verification: the brain against the PEM in
# COPY_TARGET_CA, the source against Amazon's RDS CA bundle, fetched at run
# time. A failure before the restore commits changes nothing. The checks run
# after the commit, so a failed check leaves a copy that must not be used and
# says so.
#
# What it prints: table names, row counts and a verdict. Never a row or a
# value: pg_restore's own messages (they can quote rows) are reduced to the
# table that failed, and the brain's Postgres log has the server's error.
# Guards: tests/e2e.sh, the copy scenarios (each names its mutation).
#
# Environment: COPY_SOURCE_HOST, COPY_TARGET_HOST, COPY_TARGET_CA (PEM text),
# DB_USER, DB_PASSWORD (the same role and password on both sides), DB_NAME
# (default logjam), BRAIN_SIGNALS_BUCKET, AWS_REGION; COPY_REPLACE=1 to replace
# a target that already holds tables. Credentials: the ECS task role.
# Tests only: COPY_SOURCE_CA_FILE (a CA file instead of Amazon's bundle),
# BRAIN_BACKUP_ENDPOINT (an S3 stand-in; CURL_CA_BUNDLE trusts its certificate).
set -uo pipefail
export LC_ALL=C

if [ "$(id -u)" = 0 ]; then exec gosu postgres "$0" "$@"; fi
# shellcheck source=task-lib.sh
. "$(dirname "$0")/task-lib.sh"

say() { echo "copy: $*"; }
die() { say "$*"; exit 1; }

: "${COPY_SOURCE_HOST:?}" "${COPY_TARGET_HOST:?}" "${DB_USER:?}" "${DB_PASSWORD:?}" "${BRAIN_SIGNALS_BUCKET:?}" "${AWS_REGION:?}"
DB=${DB_NAME:-logjam}
[ "$COPY_SOURCE_HOST" != "$COPY_TARGET_HOST" ] || die "the source and the target are the same host"
# The signals bucket is a trusted channel: no way to skip its certificate check here.
unset BRAIN_BACKUP_VERIFY_TLS

umask 077
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export PGUSER=$DB_USER PGPASSWORD=$DB_PASSWORD PGDATABASE=$DB PGSSLMODE=verify-full PGCONNECT_TIMEOUT=20

on_source() { PGHOST=$COPY_SOURCE_HOST PGSSLROOTCERT=$WORK/source-ca.pem "$@"; }
on_target() { PGHOST=$COPY_TARGET_HOST PGSSLROOTCERT=$WORK/target-ca.pem "$@"; }
# A query, one value per line. Its error text goes to the log: it names no data.
q() { "$1" psql -tAXq -v ON_ERROR_STOP=1 -c "$2"; }

task_credentials || exit 1

# --- the two certificates ---------------------------------------------------
[ -n "${COPY_TARGET_CA:-}" ] || die "no CA for the brain (infra/brain/brain-ca.pem is committed once the brain has booted): stopping"
printf '%s\n' "$COPY_TARGET_CA" > "$WORK/target-ca.pem"
openssl x509 -in "$WORK/target-ca.pem" -noout 2> /dev/null || die "COPY_TARGET_CA is not a certificate: stopping"
if [ -n "${COPY_SOURCE_CA_FILE:-}" ]; then
  cp "$COPY_SOURCE_CA_FILE" "$WORK/source-ca.pem" || die "cannot read COPY_SOURCE_CA_FILE"
else
  curl -fsS -m 30 -o "$WORK/source-ca.pem" https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    || die "cannot fetch Amazon's RDS CA bundle: stopping"
fi
grep -q 'BEGIN CERTIFICATE' "$WORK/source-ca.pem" || die "the source CA file holds no certificate: stopping"

# --- never a serving brain ---------------------------------------------------
# Read twice: here, and again after the dump, which can take minutes.
brain_is_dormant() {
  local status state
  status=$(s3_curl "$BRAIN_SIGNALS_BUCKET" status.json 2> /dev/null) || die "status.json cannot be read: stopping"
  state=$(jq -r 'if .serving != false then "serving"
    elif ((now - (.time | fromdateiso8601)) | fabs) >= 180 then "stale" else "ok" end' <<< "$status" 2> /dev/null) || state=unreadable
  case $state in
    ok) ;;
    serving) die "status.json does not say serving is false: stopping" ;;
    *) die "status.json is $state (it must be fresh and say serving is false): stopping" ;;
  esac
}
brain_is_dormant

# --- both sides, and what the target holds ----------------------------------
q on_target 'select 1' > /dev/null 2> "$WORK/err" || { head -c 400 "$WORK/err"; die "cannot connect to the brain, verifying its certificate against COPY_TARGET_CA: stopping"; }
q on_source 'select 1' > /dev/null 2> "$WORK/err" || { head -c 400 "$WORK/err"; die "cannot connect to the source, verifying its certificate: stopping"; }

# Everything in public that is not an extension's: tables, sequences, indexes,
# views, types, functions, with its owner.
PUBLIC_OBJECTS="select o.* from (
    select 'pg_class'::regclass as cls, c.oid as oid, c.relowner as owner from pg_class c where c.relnamespace = 'public'::regnamespace
    union all select 'pg_type'::regclass, t.oid, t.typowner from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype in ('e', 'd')
    union all select 'pg_proc'::regclass, p.oid, p.proowner from pg_proc p where p.pronamespace = 'public'::regnamespace
  ) o where not exists (select 1 from pg_depend d where d.classid = o.cls and d.objid = o.oid and d.deptype = 'e')"
held=$(q on_target "select count(*) from ($PUBLIC_OBJECTS) x") || die "cannot read the brain's schema: stopping"
if [ "$held" != 0 ] && [ "${COPY_REPLACE:-}" != 1 ]; then
  die "the brain already holds $held objects in public; set COPY_REPLACE=1 to replace them: stopping"
fi
[ "$held" = 0 ] || say "replacing the $held objects the brain holds"

readonly_source=$(q on_source 'show default_transaction_read_only') || die "cannot read the source's settings: stopping"
say "source default_transaction_read_only = $readonly_source"

# --- dump to a file, then restore in one transaction ----------------------------
on_source pg_dump --format=custom --no-owner --no-privileges --schema=public --file="$WORK/dump" 2> "$WORK/err" \
  || { tail -5 "$WORK/err"; die "the dump failed: the brain is untouched"; }
say "dumped ($(du -m "$WORK/dump" | cut -f1) MB)"

brain_is_dormant

# What the restore skips: the public schema entry and its comment. The role already
# owns the schema, and the dump's CREATE SCHEMA (or, with --clean, DROP SCHEMA) needs
# a right it does not have. (A `--schema=public` dump carries no extensions: the
# brain makes its own pgaudit.)
pg_restore -l "$WORK/dump" | grep -vE '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA - public |COMMENT - SCHEMA public )' > "$WORK/list"
clean=()
[ "${COPY_REPLACE:-}" != 1 ] || clean=(--clean --if-exists)
if ! on_target pg_restore --single-transaction --no-owner --no-privileges "${clean[@]}" --use-list="$WORK/list" --dbname="$DB" "$WORK/dump" > /dev/null 2> "$WORK/err"; then
  # pg_restore quotes the offending row in its messages (COPY errors carry a
  # CONTEXT line with it): only the failing table or schema statement is kept.
  grep -oE 'COPY failed for table "[^"]*"|^Command was: (DROP|CREATE|ALTER) .{0,100}|could not connect[^:]*|certificate verify failed' "$WORK/err" | sort -u
  die "the restore failed and was rolled back: the brain is as it was (the server's error is in the brain's Postgres log)"
fi
say "restored"

# --- verify ---------------------------------------------------------------------------
failed=0
fail() { say "NOT VERIFIED: $*"; failed=1; }

row_counts() { # name|rows for every table in public
  local qry
  qry=$(q "$1" "select coalesce(string_agg(format('select %L, count(*) from public.%I', tablename, tablename), ' union all ' order by tablename), 'select null::text, null::bigint where false') from pg_tables where schemaname = 'public'") || return 1
  q "$1" "select a || '|' || b from ($qry) as t(a, b) order by 1"
}
sequence_values() { q "$1" "select sequencename || '|' || coalesce(last_value::text, '') from pg_sequences where schemaname = 'public' order by 1"; }
counts_src=$(row_counts on_source) || fail "a row count could not be read"
counts_dst=$(row_counts on_target) || fail "a row count could not be read"
seqs_src=$(sequence_values on_source) || fail "a sequence could not be read"
seqs_dst=$(sequence_values on_target) || fail "a sequence could not be read"

# A read-only source cannot move, so its copy matches exactly. A live one keeps
# writing after the dump: a difference is a warning.
differ() { # <what> <source lines> <target lines>
  local rows
  [ "$2" != "$3" ] || return 0
  rows=$(join -t'|' -a1 -a2 -e missing -o 0,1.2,2.2 <(sort <<< "$2") <(sort <<< "$3") | awk -F'|' '$2 != $3 { print "  " $1 ": source " $2 ", brain " $3 }')
  if [ "$readonly_source" = on ]; then fail "$1 differ:"; else say "warning: $1 differ (the source is live):"; fi
  echo "$rows"
}
say "tables and rows (table | rows in the brain):"
echo "$counts_dst" | tr '|' ' ' | sed 's/^/  /'
tables_src=$(cut -d'|' -f1 <<< "$counts_src") tables_dst=$(cut -d'|' -f1 <<< "$counts_dst")
[ "$tables_src" = "$tables_dst" ] || fail "the brain's tables are not the source's"
differ "row counts" "$counts_src" "$counts_dst"
differ "sequence values" "$seqs_src" "$seqs_dst"

unowned=$(q on_target "select count(*) from ($PUBLIC_OBJECTS) x where x.owner <> (select oid from pg_roles where rolname = current_user)") || unowned=unknown
[ "$unowned" = 0 ] || fail "$unowned objects in public are not owned by $DB_USER"
[ "$(q on_target 'show default_transaction_read_only')" = off ] || fail "the brain's database is read-only"
last() { q "$1" 'select migration_name from _prisma_migrations order by migration_name desc limit 1'; }
migration=$(last on_target)
if [ -z "$migration" ] || [ "$migration" != "$(last on_source)" ]; then fail "the last migration differs"; fi

[ "$failed" = 0 ] || die "RESTORED BUT NOT VERIFIED: do not serve from this copy; fix the cause and run again with COPY_REPLACE=1"
say "ok: every check held"
