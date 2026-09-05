-- Privacy scrub applied to a prod snapshot before it leaves the operator's
-- machine. Run by scripts/snapshot.sh against a throwaway restore of the dump.
--
-- ON_ERROR_STOP IS THE POINT OF THIS FILE. psql exits 0 after a statement
-- error inside a heredoc, and `set -e` in the caller does not catch it — so
-- before this line existed, a scrub statement naming a table that had been
-- RENAMED printed `relation "canyons" does not exist` and then cheerfully
-- exported a snapshot with every note intact. The mandatory privacy boundary
-- failed open, quietly. Coverage is pinned by
-- api/src/lib/snapshotScrub.unit.test.ts, which fails when a column joins the
-- schema without joining this file.
\set ON_ERROR_STOP on

-- Identity: real emails and Cognito ids become safe locals.
UPDATE users
SET
  email      = 'user-' || id || '@local',
  cognito_id = 'sanitized-' || id,
  username   = 'user-' || substring(id::text, 1, 8);

-- Everything a user typed. A place NAME is as sensitive as its notes under the
-- NPWS guidance in CLAUDE.md — "Claustral" and "the one below the third
-- waterfall" are the same disclosure — and so are the free-text tags and the
-- attributes blob (sources, rock type, custom-field values). `tags`, `field_values`
-- and `foreign_fields` join `places` in later phases; the coverage test above
-- fails until they are added here too.
UPDATE places
SET name = 'place-' || substring(id::text, 1, 8),
    alt_names = '{}',
    notes = NULL,
    attributes = '{}';

UPDATE waypoints
SET name = 'waypoint-' || substring(id::text, 1, 8),
    notes = NULL,
    tags = '{}';

UPDATE trip_logs
SET notes = NULL,
    display_name = NULL,
    custom_fields = '{}';

-- User-authored field LABELS name the thing they describe ("Which slot for the
-- Ranon exit"), so they go the same way as the values keyed by them.
UPDATE custom_field_defs SET label = 'field-' || substring(id::text, 1, 8);

UPDATE routes SET name = 'route-' || substring(id::text, 1, 8);
UPDATE media SET display_name = NULL, filename = 'file-' || substring(id::text, 1, 8);

-- DELIBERATELY NOT SCRUBBED, so the omission reads as a decision:
--   places.latitude/longitude, routes.points/anchors, media.metadata —
--   coordinates and geometry. A snapshot exists to give a dev real map data;
--   scrubbing the coordinates leaves nothing to develop against. The operator's
--   boundary here is identity plus free text, and the snapshot stays as
--   sensitive as the prod DB in the geographic dimension — treat the file
--   accordingly. Upgrade path, if that ever stops being acceptable: jitter the
--   coordinates by a few km per owner rather than nulling them.
