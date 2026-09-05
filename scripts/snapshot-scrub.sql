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
--
-- The username uses the WHOLE id, not its first 8 characters. The short form
-- collided on the dev seed, whose ids share a `00000000` prefix by design, and
-- `users.username` is UNIQUE — so the scrub aborted on its first statement and
-- (before ON_ERROR_STOP) everything after it silently did not run. Two random
-- prod uuids can collide on 8 hex characters too; this removes the class.
UPDATE users
SET
  email      = 'user-' || id || '@local',
  cognito_id = 'sanitized-' || id,
  username   = 'user-' || id;

-- Everything a user typed. A place NAME is as sensitive as its notes under the
-- NPWS guidance in CLAUDE.md — "Claustral" and "the one below the third
-- waterfall" are the same disclosure — and so are the free-text tags and the
-- field values. `field_values` holds what the user typed into every field they
-- defined, AND their source links and the legacy attributes bag; `foreign_fields`
-- holds the same thing copied from someone else, labels included. Both are as
-- sensitive as notes and neither is optional to scrub.
--
-- `tags` joins `places` in phase 1c and the coverage test fails until it is
-- added here too — which is how these two arrived.
UPDATE places
SET name = 'place-' || substring(id::text, 1, 8),
    "altNames" = '{}',
    notes = NULL,
    field_values = '{}',
    foreign_fields = NULL;

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
