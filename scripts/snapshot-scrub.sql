-- Privacy scrub applied to a prod snapshot before it leaves the operator's
-- machine. Run by scripts/snapshot.sh against a throwaway restore of the dump.
--
-- ON_ERROR_STOP is required: psql exits 0 after a statement error inside a
-- heredoc and `set -e` in the caller does not catch it. Without it, a table or
-- column rename causes statements to fail silently while continuing to export
-- unscrubbed data. Coverage is pinned by
-- api/src/lib/snapshotScrub.unit.test.ts, which fails when a column joins the
-- schema without joining this file.
\set ON_ERROR_STOP on

-- Identity: real emails and Cognito ids become safe locals.
--
-- The username uses the full id, not its first 8 characters: dev seed ids share
-- a `00000000` prefix by design and random uuids can collide on 8 characters,
-- which violates `users.username` UNIQUE.
UPDATE users
SET
  email      = 'user-' || id || '@local',
  cognito_id = 'sanitized-' || id,
  username   = 'user-' || id;

-- Everything a user typed. A place NAME is as sensitive as its notes under the
-- NPWS guidance in AGENTS.md — "Claustral" and "the one below the third
-- waterfall" are the same disclosure — and so are the field values.
-- `field_values` holds what the user typed into every field they defined, AND
-- their source links and the legacy attributes bag; `foreign_fields` holds the
-- same thing copied from someone else, labels included. Both are as sensitive
-- as notes and neither is optional to scrub.
--
-- The coverage test runs in both directions: it fails if a listed column does
-- not exist or if a user-authored String/Json column is missing from this file.
-- Note that arm reads String/Json columns only — a numeric that needs scrubbing
-- would have to be added here by hand.
UPDATE places
SET name = 'place-' || substring(id::text, 1, 8),
    "altNames" = '{}',
    notes = NULL,
    field_values = '{}',
    foreign_fields = NULL;

-- TRIP TYPES are user-authored tags ("Claustral recon", "with Dad"), held in two
-- places that must keep MATCHING after the scrub: a trip's own `types`, and the
-- `trip_types` a trip attribute is scoped to (compared case-insensitively). So
-- each tag becomes a stable pseudonym of its LOWERCASED text — the same tag
-- scrubs the same way in both columns, and "Packrafting"/"packrafting" stay one
-- tag — in its original order, which picks a trip's glyph.
--
-- The app's own suggested types are not user text and survive: dev stats and
-- analytics key on `canyoning`. That list is TRIP_TYPE_SUGGESTIONS
-- (shared/src/tripName.ts), and snapshotScrub.unit.test.ts fails when the two
-- disagree.
CREATE FUNCTION pg_temp.scrub_trip_types(tags text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    array_agg(
      CASE
        WHEN lower(tag) = ANY (ARRAY['canyoning', 'bushwalking', 'bikepacking', 'packrafting'])
          THEN tag
        ELSE 'type-' || substring(md5(lower(tag)), 1, 8)
      END
      ORDER BY ord
    ),
    '{}'
  )
  FROM unnest(tags) WITH ORDINALITY AS u(tag, ord)
$$;

UPDATE trip_logs
SET notes = NULL,
    display_name = NULL,
    custom_fields = '{}',
    types = pg_temp.scrub_trip_types(types);

-- User-authored field LABELS name the thing they describe ("Which slot for the
-- Ranon exit"), so they go the same way as the values keyed by them. A trip
-- attribute's `trip_types` go the way of the trip types above.
UPDATE custom_field_defs
SET label = 'field-' || substring(id::text, 1, 8),
    trip_types = pg_temp.scrub_trip_types(trip_types);

-- Undo's copies of the place and trip fields scrubbed above. Blank, Undo
-- restores nothing.
UPDATE import_snapshots SET before = '{}', after = '{}';

UPDATE routes SET name = 'route-' || substring(id::text, 1, 8);
UPDATE media SET display_name = NULL, filename = 'file-' || substring(id::text, 1, 8);

-- Plans: the write-up, the forms and every answer. Safety contacts are names
-- and phone numbers of people who are not Logjam users.
UPDATE trip_plans
SET name = 'plan-' || substring(id::text, 1, 8),
    trip_types = pg_temp.scrub_trip_types(trip_types);
UPDATE trip_plan_sections
SET title = 'section-' || substring(id::text, 1, 8),
    body = '';
UPDATE trip_plan_forms
SET title = 'form-' || substring(id::text, 1, 8),
    questions = '[]';
UPDATE trip_plan_answers SET answers = '{}';

-- DELIBERATELY NOT SCRUBBED, so the omission reads as a decision:
--   places.latitude/longitude, routes.points/anchors, media.metadata —
--   coordinates and geometry. A snapshot exists to give a dev real map data;
--   scrubbing the coordinates leaves nothing to develop against. The operator's
--   boundary here is identity plus free text, and the snapshot stays as
--   sensitive as the prod DB in the geographic dimension — treat the file
--   accordingly. Upgrade path, if that ever stops being acceptable: jitter the
--   coordinates by a few km per owner rather than nulling them.
