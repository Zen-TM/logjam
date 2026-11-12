-- Plants a recognisable marker in every column snapshot-scrub.sql scrubs, so
-- scripts/snapshot-scrub-canary.sh can prove the marker is gone after the scrub.
-- Every marker is `CANARY-<table>-<column>`, made up; a row id follows where the
-- column is unique. One plant per column in SCRUBBED in
-- api/src/lib/snapshotScrub.unit.test.ts, which fails when the two disagree.
\set ON_ERROR_STOP on

UPDATE users
SET email    = 'CANARY-users-email-' || id,
    subject  = 'CANARY-users-subject-' || id,
    username = 'CANARY-users-username-' || id,
    ui_preferences = jsonb_build_object(
      'tripLogCustomFields', jsonb_build_array(jsonb_build_object('label', 'CANARY-users-ui_preferences')),
      'canyonCustomFields', jsonb_build_array(jsonb_build_object('label', 'CANARY-users-ui_preferences')),
      'placeCustomFields', jsonb_build_array(jsonb_build_object('label', 'CANARY-users-ui_preferences'))
    );

UPDATE custom_field_defs
SET label = 'CANARY-custom_field_defs-label',
    trip_types = ARRAY['CANARY-custom_field_defs-trip_types'];

-- The system types are app copy and must come through the scrub untouched.
UPDATE place_types SET name = 'CANARY-place_types-name-' || id WHERE owner_id IS NOT NULL;

UPDATE places
SET type_name = 'CANARY-places-type_name',
    name = 'CANARY-places-name',
    "altNames" = ARRAY['CANARY-places-altNames'],
    notes = 'CANARY-places-notes',
    gauge_id = 'CANARY-places-gauge_id',
    field_values = jsonb_build_object('k', 'CANARY-places-field_values'),
    foreign_fields = jsonb_build_object('k', 'CANARY-places-foreign_fields');

-- No seed holds an import's Undo copy.
INSERT INTO import_snapshots (id, owner_id, batch_id, place_id, before, after)
SELECT gen_random_uuid()::text, owner_id, 'canary-batch', id,
       jsonb_build_object('k', 'CANARY-import_snapshots-before'),
       jsonb_build_object('k', 'CANARY-import_snapshots-after')
FROM places LIMIT 1;

UPDATE trip_logs
SET display_name = 'CANARY-trip_logs-display_name',
    types = ARRAY['CANARY-trip_logs-types'],
    notes = 'CANARY-trip_logs-notes',
    custom_fields = jsonb_build_object('k', 'CANARY-trip_logs-custom_fields');

UPDATE media
SET filename = 'CANARY-media-filename',
    display_name = 'CANARY-media-display_name';

UPDATE routes SET name = 'CANARY-routes-name';
UPDATE topo_jobs SET name = 'CANARY-topo_jobs-name';
UPDATE topo_templates SET name = 'CANARY-topo_templates-name';
UPDATE device_tokens SET token = 'CANARY-device_tokens-token-' || id;
UPDATE file_sends SET filename = 'CANARY-file_sends-filename';

UPDATE trip_plans
SET name = 'CANARY-trip_plans-name',
    trip_types = ARRAY['CANARY-trip_plans-trip_types'];
UPDATE trip_plan_sections
SET title = 'CANARY-trip_plan_sections-title',
    body = 'CANARY-trip_plan_sections-body';
UPDATE trip_plan_forms
SET title = 'CANARY-trip_plan_forms-title',
    questions = jsonb_build_array(jsonb_build_object('label', 'CANARY-trip_plan_forms-questions'));
UPDATE trip_plan_answers
SET answers = jsonb_build_object('k', 'CANARY-trip_plan_answers-answers');

UPDATE notifications
SET payload = jsonb_build_object(
  'planName', 'CANARY-notifications-payload',
  'filename', 'CANARY-notifications-payload',
  'jobName', 'CANARY-notifications-payload'
);
