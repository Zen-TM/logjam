#!/usr/bin/env bash
# Plan §7.10 — run the places-rework migrations against a populated database and
# assert what came out the other side.
#
# WHY THIS IS A SCRIPT AND NOT A VITEST: it needs a real Postgres, it creates
# and drops databases, and what it verifies is SQL rather than TypeScript. The
# repo already has this shape for the same reason — topo/tests/
# test_status_guard_db.py is gated on RUN_DB_IT for a real-Postgres invariant.
# Not in CI (nothing in CI has a database to spare); run it before committing a
# change to either migration.
#
# WHY THE FIXTURE IS BUILT BY HAND: the shapes that matter here CANNOT be
# produced by the dev seed, because they only exist BEFORE the migration —
# custom-field values nested at `attributes.customFields`, the flat legacy keys
# beside them, and a user definition whose key collides with a system one. The
# dev database has never had any of them, which is exactly why the hoist needed
# proving against something built on purpose.
#
#   ./scripts/verify-places-migration.sh
#
# Env: PGCONTAINER (default logjam-postgres-1), PGUSER (default logjam).
set -euo pipefail

CONTAINER="${PGCONTAINER:-logjam-postgres-1}"
DBUSER="${PGUSER:-logjam}"
DB="places_migration_check"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../api/prisma/migrations"
PHASE_1B="20260906010000_place_types_and_field_values"

psql_() { docker exec -i "$CONTAINER" psql -U "$DBUSER" -d "$1" -v ON_ERROR_STOP=1 -q; }
query() { docker exec "$CONTAINER" psql -U "$DBUSER" -d "$DB" -Atc "$1"; }

fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  ok    $1"
  else
    echo "  FAIL  $1"
    echo "        expected: $2"
    echo "        actual:   $3"
    fail=$((fail + 1))
  fi
}

echo "==> recreating $DB"
docker exec "$CONTAINER" psql -U "$DBUSER" -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
docker exec "$CONTAINER" psql -U "$DBUSER" -d postgres -c "CREATE DATABASE $DB" >/dev/null

echo "==> applying every migration BEFORE $PHASE_1B"
for dir in $(ls -d "$MIGRATIONS"/*/ | sort); do
  case "$dir" in *"$PHASE_1B"*) continue ;; esac
  psql_ "$DB" < "$dir/migration.sql" >/dev/null
done

echo "==> seeding the pre-migration shapes the dev database has never had"
psql_ "$DB" <<'SQL' >/dev/null
INSERT INTO users (id, cognito_id, username, email, created_at, ui_preferences, egress_period_start)
VALUES ('00000000-0000-4000-8000-000000000001','s-a','alice','a@local',now(),
        '{"importMergePolicy":{"vGrade":"useIncoming","numAbseils":"keepExisting","notes":"useIncoming"}}'::jsonb, now()),
       ('00000000-0000-4000-8000-000000000002','s-b','bob','b@local',now(),'{}'::jsonb, now());

-- Two owners with the SAME colliding key, so the rename has to be per-owner.
INSERT INTO custom_field_defs (id, owner_id, entity, key, label, type, min, max, position, created_at, updated_at) VALUES
  ('c0000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','place','quality','Quality','integer',1,10,0,now(),now()),
  ('c0000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','place','water_temp','Water temp','float',0,30,1,now(),now()),
  ('c0000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','place','quality','Quality','integer',1,10,0,now(),now());

INSERT INTO places (id, owner_id, name, "altNames", latitude, longitude, notes, attributes,
                    v_grade, a_grade, commitment, quality, hours, num_abseils, longest_abseil_m,
                    created_at, updated_at)
VALUES
-- everything at once: a nested COLLIDING value, a nested ordinary value, the
-- flat legacy keys, a source list, and real grade columns
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Claustral Canyon','{}',-33.56,150.40,'notes',
   jsonb_build_object('customFields', jsonb_build_object('quality', 9, 'water_temp', 12.5),
                      'sources', jsonb_build_array(jsonb_build_array('Wiki','https://example.test/a')),
                      'rockType','sandstone','wetsuit',3),
   3, 2, 3, 4.5, 5.5, 7, 20, now(), now()),
-- nested value and NO grades, so the hoist cannot be an artefact of the lift
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Empress Falls','{}',-33.72,150.36,NULL,
   jsonb_build_object('customFields', jsonb_build_object('water_temp', 8)),
   NULL,NULL,NULL,NULL,NULL,NULL,NULL, now(), now()),
-- the same colliding key under a DIFFERENT owner
  ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','Coin Slot','{}',-33.4,150.2,NULL,
   jsonb_build_object('customFields', jsonb_build_object('quality', 2)),
   NULL,NULL,NULL,NULL,NULL,NULL,NULL, now(), now()),
-- nothing to hoist at all: must produce {} rather than null or an empty husk
  ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Bare Place','{}',-33.1,150.1,NULL,
   '{}'::jsonb, NULL,NULL,NULL,NULL,NULL,NULL,NULL, now(), now());
SQL

BEFORE_PLACES=$(query "select count(*) from places")

echo "==> applying $PHASE_1B"
psql_ "$DB" < "$MIGRATIONS/$PHASE_1B/migration.sql" 2>&1 | grep -E "^(NOTICE|ERROR)" || true

echo
echo "==> assertions"

check "no place lost" "$BEFORE_PLACES" "$(query 'select count(*) from places')"
check "no place is type-less" "0" "$(query 'select count(*) from places where place_type_id is null')"
check "ids preserved" "Claustral Canyon" \
  "$(query "select name from places where id='10000000-0000-4000-8000-000000000001'")"
check "three system types" "3" "$(query 'select count(*) from place_types where owner_id is null')"

# THE HOIST. A nested value must end up at the TOP level of field_values. A flat
# `attributes || grades` merge leaves it at field_values.customFields.<key>,
# where the renderer, the filter and mergePlace all fail to find it — no error,
# no warning, every value a user ever typed simply invisible.
check "nested value hoisted to the top level" "12.5" \
  "$(query "select field_values->>'water_temp' from places where name='Claustral Canyon'")"
check "hoist does not depend on the grade columns" "8" \
  "$(query "select field_values->>'water_temp' from places where name='Empress Falls'")"
check "no customFields husk survives" "0" \
  "$(query "select count(*) from places where field_values ? 'customFields'")"
check "nothing to hoist yields an empty object" "{}" \
  "$(query "select field_values::text from places where name='Bare Place'")"

# THE COLLISION. The system def wins the reserved key; the user's def is renamed
# and its VALUES move with it. Never two writers on one key.
check "lifted column keeps the reserved key" "4.5" \
  "$(query "select field_values->>'quality' from places where name='Claustral Canyon'")"
check "colliding user value remapped, not overwritten" "9" \
  "$(query "select field_values->>'quality_2' from places where name='Claustral Canyon'")"
check "the rename is per-owner" "2" \
  "$(query "select field_values->>'quality_2' from places where name='Coin Slot'")"
check "both owners' defs renamed" "2" \
  "$(query "select count(*) from custom_field_defs where key='quality_2'")"
check "no user def still holds a reserved key" "0" \
  "$(query "select count(*) from custom_field_defs where owner_id is not null and key in ('v_grade','a_grade','commitment','quality','hours','num_abseils','longest_abseil','capacity','is_cave')")"

# THE RESERVED NAMESPACE. `_`-prefixed keys cannot collide with a user key,
# because makeCustomFieldKey cannot produce one (shared/src/placeTypes.test.ts).
check "sources parked under _sources" "Wiki" \
  "$(query "select field_values->'_sources'->0->>0 from places where name='Claustral Canyon'")"
check "legacy attribute keys preserved under _attributes" "sandstone" \
  "$(query "select field_values->'_attributes'->>'rockType' from places where name='Claustral Canyon'")"

# Grade columns lifted, NULLs omitted rather than stored — a stored null renders
# as an empty field and satisfies a "has a value" filter.
check "grade column lifted" "3" \
  "$(query "select field_values->>'v_grade' from places where name='Claustral Canyon'")"
check "null grade omitted, not stored as null" "f" \
  "$(query "select (field_values ? 'v_grade') from places where name='Empress Falls'")"

# Stored merge policies are keyed by MERGEABLE_FIELD, which was column names and
# is now field keys. Unmigrated, they do not error — every field silently falls
# back to the default policy.
check "merge policy keys rewritten" "useIncoming" \
  "$(query "select ui_preferences->'importMergePolicy'->>'v_grade' from users where username='alice'")"
check "merge policy drops the old key" "" \
  "$(query "select ui_preferences->'importMergePolicy'->>'vGrade' from users where username='alice'")"
check "unrelated policy keys untouched" "useIncoming" \
  "$(query "select ui_preferences->'importMergePolicy'->>'notes' from users where username='alice'")"

# The unique index Prisma cannot express. Without NULLS NOT DISTINCT a re-run or
# a repeat deploy inserts a SECOND global "Canyon", and copy reconciliation —
# which matches an incoming type by NAME — resolves to whichever it saw first.
# The insert is EXPECTED to fail, so its non-zero exit must not trip `set -e`
# (and `pipefail` means piping it through head does not mask that).
DUP=$(docker exec "$CONTAINER" psql -U "$DBUSER" -d "$DB" -Atc \
  "insert into place_types (id,owner_id,name,icon_key,color,updated_at) values ('b0000000-0000-4000-8000-0000000000ff',NULL,'Canyon','droplet','#F97316',now())" 2>&1 || true)
DUP=$(printf '%s' "$DUP" | head -1)
case "$DUP" in
  *"duplicate key"*) echo "  ok    a second global Canyon type is refused" ;;
  *) echo "  FAIL  a second global Canyon type was ACCEPTED: $DUP"; fail=$((fail + 1)) ;;
esac

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL PASS"
  docker exec "$CONTAINER" psql -U "$DBUSER" -d postgres -c "DROP DATABASE $DB" >/dev/null
else
  echo "$fail FAILURE(S) — $DB left in place for inspection"
  exit 1
fi
