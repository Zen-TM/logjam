-- Stage 1: vector styles as live first-class citizens
--
-- 1. Add User.vector_style and TopoJob.vector_style_snapshot columns.
-- 2. Backfill User.vector_style from each user's most recently-updated
--    TopoTemplate.config, or the hardcoded VECTOR_STYLE_DEFAULTS if they have
--    no templates.
-- 3. Strip vector-only fields (contour colours/widths, OSM per-category
--    style + enablement) from every TopoTemplate.config — those keys now
--    live exclusively on the user. The remaining template config matches
--    RasterTemplateSettings (hillshade, slope, vegetation, contour zoom
--    bands, top-level enabled toggles).
--
-- App is unreleased; user data is not yet sacred. Hard one-shot migration.

ALTER TABLE "users"     ADD COLUMN "vector_style"           JSONB;
ALTER TABLE "topo_jobs" ADD COLUMN "vector_style_snapshot"  JSONB;

-- VECTOR_STYLE_DEFAULTS, must match shared/src/topoSettings.ts.
-- Kept inline in the migration so it never depends on application code.
CREATE OR REPLACE FUNCTION pg_temp.vector_style_defaults() RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'contours', jsonb_build_object(
      'majorColour', '#503c28dc',
      'minorColour', '#785a3ca0',
      'majorWidthM', 18,
      'minorWidthM', 8
    ),
    'features', jsonb_build_object(
      'waterway',  jsonb_build_object('enabled', true,  'colour', '#2878dcdc', 'widthZ18', 3),
      'track',     jsonb_build_object('enabled', true,  'colour', '#a0641edc', 'widthZ18', 2),
      'road',      jsonb_build_object('enabled', true,  'colour', '#505050e6', 'widthZ18', 4),
      'building',  jsonb_build_object('enabled', true,  'colour', '#a08c78c8', 'widthZ18', 2),
      'power',     jsonb_build_object('enabled', true,  'colour', '#c8a000c8', 'widthZ18', 1),
      'campsite',  jsonb_build_object('enabled', true,  'colour', '#00a050e6', 'widthZ18', 14),
      'peak',      jsonb_build_object('enabled', true,  'colour', '#503214f0', 'widthZ18', 12),
      'spring',    jsonb_build_object('enabled', true,  'colour', '#1e5ad2e6', 'widthZ18', 8),
      'gate',      jsonb_build_object('enabled', true,  'colour', '#464646dc', 'widthZ18', 10),
      'cave',      jsonb_build_object('enabled', true,  'colour', '#3c1e0ae6', 'widthZ18', 10),
      'bridge',    jsonb_build_object('enabled', false, 'colour', '#403028e6', 'widthZ18', 3),
      'ford',      jsonb_build_object('enabled', false, 'colour', '#1e90ffe6', 'widthZ18', 8),
      'waterfall', jsonb_build_object('enabled', false, 'colour', '#1e6ad2f0', 'widthZ18', 10),
      'trailhead', jsonb_build_object('enabled', false, 'colour', '#a04020e6', 'widthZ18', 12),
      'viewpoint', jsonb_build_object('enabled', false, 'colour', '#806020e6', 'widthZ18', 12),
      'hut',       jsonb_build_object('enabled', false, 'colour', '#503820e6', 'widthZ18', 12)
    )
  );
$$ LANGUAGE SQL IMMUTABLE;

-- For each user with at least one template, extract vector style fields from
-- the most-recently-updated template's config.
WITH latest_per_user AS (
  SELECT DISTINCT ON (user_id) user_id, config
  FROM topo_templates
  ORDER BY user_id, updated_at DESC
),
extracted AS (
  SELECT
    user_id,
    jsonb_build_object(
      'contours', jsonb_build_object(
        'majorColour', COALESCE(config->'contours'->>'majorColour', '#503c28dc'),
        'minorColour', COALESCE(config->'contours'->>'minorColour', '#785a3ca0'),
        'majorWidthM', COALESCE((config->'contours'->>'majorWidthM')::numeric, 18),
        'minorWidthM', COALESCE((config->'contours'->>'minorWidthM')::numeric, 8)
      ),
      'features', COALESCE(config->'features'->'features', pg_temp.vector_style_defaults()->'features')
    ) AS vector_style
  FROM latest_per_user
)
UPDATE users u
SET vector_style = e.vector_style
FROM extracted e
WHERE u.id = e.user_id;

-- Every other user (no templates) gets the defaults.
UPDATE users SET vector_style = pg_temp.vector_style_defaults() WHERE vector_style IS NULL;

-- Strip vector-only keys from every template's config blob.
UPDATE topo_templates
SET config = jsonb_set(
  (config #- '{contours,majorColour}'
          #- '{contours,minorColour}'
          #- '{contours,majorWidthM}'
          #- '{contours,minorWidthM}'),
  '{features}',
  jsonb_build_object('enabled', COALESCE(config->'features'->>'enabled', 'true')::boolean)
);
