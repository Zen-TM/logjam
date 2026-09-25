-- Migration UPGRADE check, part 1 of 2: runs against the database at the BASE
-- schema (what prod runs today — `origin/main`), after its seed, BEFORE the
-- head's migrations. Captures what the data looks like so verify.sql can
-- assert the migrations carried it across. Driven by
-- scripts/migration-upgrade-test.sh; the same pair runs against a restored
-- prod snapshot for a release rehearsal (without fixtures).
--
-- Why this exists: the `migrations` CI job applies every migration to an EMPTY
-- database, so a migration that mishandles an existing row (a backfill that
-- misses one, a SET NOT NULL over a null, a rename collision) passes CI and
-- fails — or silently drops data — on prod.
--
-- RELEASE-SPECIFIC. The metrics below describe the canyons -> places rework
-- (main -> next, 2026-09). They switch themselves off once the base schema has
-- no `canyons` table; the next release that moves data replaces them. The
-- generic half (migrations apply over real rows; the result matches
-- schema.prisma) lives in the script and never goes stale.
--
-- `-v fixtures=1` first inserts edge cases the seed does not have (reserved-key
-- collisions, grade columns, legacy prefs-held field definitions). CI only —
-- never against a prod copy.

\set ON_ERROR_STOP on

SELECT to_regclass('public.canyons') IS NOT NULL AS applies \gset
\if :applies

\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email, ui_preferences) VALUES
  ('upgrade-fixture-owner', 'upgrade-fixture-owner-sub', 'upgrade_owner', 'owner@upgrade.invalid',
   '{"canyonCustomFields": [
       {"key": "capacity",  "label": "Group limit", "type": "integer"},
       {"key": "has_water", "label": "Water?",      "type": "boolean"},
       {"key": "rope",      "label": "Rope",        "type": "float", "min": 0, "max": 200}
     ],
     "tripLogCustomFields": [
       {"key": "party", "label": "Party size", "type": "integer"}
     ]}'),
  ('upgrade-fixture-friend', 'upgrade-fixture-friend-sub', 'upgrade_friend', 'friend@upgrade.invalid', '{}');

-- `capacity` and `has_water` are keys the rework later RESERVES for system
-- fields; the migrations must rename the user's definition and move its value.
INSERT INTO canyons (id, owner_id, name, latitude, longitude, num_abseils, longest_abseil_m,
                     v_grade, a_grade, commitment, quality, hours, attributes, updated_at) VALUES
  ('upgrade-fixture-graded', 'upgrade-fixture-owner', 'Graded', -33.6, 150.3, 4, 25.5, 3, 2, 3, 4.5, 6,
   '{"customFields": {"capacity": 5, "has_water": true, "rope": 60},
     "sources": {"v_grade": "ropewiki"}}', now()),
  ('upgrade-fixture-bare', 'upgrade-fixture-owner', 'Bare', -33.7, 150.4,
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, '{}', now());

INSERT INTO canyon_shares (id, canyon_id, shared_by_id, shared_with_id) VALUES
  ('upgrade-fixture-share', 'upgrade-fixture-graded', 'upgrade-fixture-owner', 'upgrade-fixture-friend');

INSERT INTO trip_logs (id, user_id, date, custom_fields) VALUES
  ('upgrade-fixture-trip', 'upgrade-fixture-owner', now(), '{"party": 4}');
INSERT INTO trip_log_canyons (trip_log_id, canyon_id, position) VALUES
  ('upgrade-fixture-trip', 'upgrade-fixture-graded', 0),
  ('upgrade-fixture-trip', 'upgrade-fixture-bare', 1);

INSERT INTO media (id, owner_id, linked_type, linked_id, s3_key_display, media_type, filename, file_size_bytes) VALUES
  ('upgrade-fixture-media', 'upgrade-fixture-owner', 'canyon', 'upgrade-fixture-graded',
   'fixture/display.jpg', 'photo', 'display.jpg', 1);

INSERT INTO notifications (id, user_id, type, payload) VALUES
  ('upgrade-fixture-note', 'upgrade-fixture-friend', 'canyon_shared',
   '{"canyonId": "upgrade-fixture-graded", "canyonName": "Graded", "sharedById": "upgrade-fixture-owner"}');
\endif

DROP SCHEMA IF EXISTS upgrade_check CASCADE;
CREATE SCHEMA upgrade_check;

CREATE TABLE upgrade_check.baseline AS
SELECT * FROM (VALUES
  ('users',             (SELECT count(*) FROM users)),
  ('places',            (SELECT count(*) FROM canyons)),
  ('place_shares',      (SELECT count(*) FROM canyon_shares)),
  ('trip_logs',         (SELECT count(*) FROM trip_logs)),
  ('trip_log_places',   (SELECT count(*) FROM trip_log_canyons)),
  ('friendships',       (SELECT count(*) FROM friendships)),
  ('notifications',     (SELECT count(*) FROM notifications)),
  ('place_shared_notes',(SELECT count(*) FROM notifications WHERE type = 'canyon_shared')),
  ('media',             (SELECT count(*) FROM media)),
  ('media_on_places',   (SELECT count(*) FROM media WHERE linked_type = 'canyon')),
  ('geo_pdf_marker_cfg',(SELECT count(*) FROM geo_pdf_templates WHERE config ? 'canyonMarkers')),
  -- Field definitions held as arrays on users.ui_preferences become rows.
  ('user_field_defs',   (SELECT coalesce(sum(
                           CASE WHEN jsonb_typeof(ui_preferences -> 'canyonCustomFields') = 'array'
                                THEN jsonb_array_length(ui_preferences -> 'canyonCustomFields') ELSE 0 END
                         + CASE WHEN jsonb_typeof(ui_preferences -> 'tripLogCustomFields') = 'array'
                                THEN jsonb_array_length(ui_preferences -> 'tripLogCustomFields') ELSE 0 END), 0)
                         FROM users)),
  -- Grade columns become field_values keys (longest_abseil_m -> longest_abseil).
  ('v_grade',           (SELECT count(*) FROM canyons WHERE v_grade IS NOT NULL)),
  ('a_grade',           (SELECT count(*) FROM canyons WHERE a_grade IS NOT NULL)),
  ('commitment',        (SELECT count(*) FROM canyons WHERE commitment IS NOT NULL)),
  ('quality',           (SELECT count(*) FROM canyons WHERE quality IS NOT NULL)),
  ('hours',             (SELECT count(*) FROM canyons WHERE hours IS NOT NULL)),
  ('num_abseils',       (SELECT count(*) FROM canyons WHERE num_abseils IS NOT NULL)),
  ('longest_abseil',    (SELECT count(*) FROM canyons WHERE longest_abseil_m IS NOT NULL)),
  ('_sources',          (SELECT count(*) FROM canyons WHERE attributes ? 'sources')),
  -- Every user-authored value, counted by key: a rename may change the key,
  -- never the number of them.
  ('custom_values',     (SELECT count(*) FROM canyons,
                           jsonb_object_keys(CASE WHEN jsonb_typeof(attributes -> 'customFields') = 'object'
                                                  THEN attributes -> 'customFields' ELSE '{}' END)))
) AS t(metric, value);

\echo 'upgrade-check baseline captured:'
SELECT metric, value FROM upgrade_check.baseline ORDER BY metric;

\else
\echo 'upgrade-check: base has no canyons table — the places-rework checks no longer apply; replace them for this release.'
\endif
