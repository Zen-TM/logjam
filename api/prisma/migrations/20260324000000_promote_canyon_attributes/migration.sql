-- Step 1: Add new columns
ALTER TABLE "canyons" ADD COLUMN "v_grade" INTEGER;
ALTER TABLE "canyons" ADD COLUMN "a_grade" INTEGER;
ALTER TABLE "canyons" ADD COLUMN "commitment" INTEGER;
ALTER TABLE "canyons" ADD COLUMN "quality" INTEGER;
ALTER TABLE "canyons" ADD COLUMN "wetsuits" INTEGER;
ALTER TABLE "canyons" ADD COLUMN "hours" DOUBLE PRECISION;

-- Step 2: Copy values from attributes JSON into new columns
UPDATE "canyons" SET
  "v_grade"    = (attributes->>'v_grade')::int,
  "a_grade"    = (attributes->>'a_grade')::int,
  "commitment" = (attributes->>'commitment')::int,
  "quality"    = (attributes->>'quality')::int,
  "wetsuits"   = (attributes->>'wetsuits')::int,
  "hours"      = (attributes->>'hours')::double precision
WHERE attributes IS NOT NULL AND attributes != '{}'::jsonb;

-- Step 3: Strip promoted keys + description from attributes JSON
UPDATE "canyons" SET
  attributes = attributes - ARRAY['v_grade','a_grade','commitment','quality','wetsuits','hours','rock_type','description']
WHERE attributes IS NOT NULL AND attributes != '{}'::jsonb;

-- Step 4: Update ropeWikiSnapshot JSON to match new column structure
UPDATE "canyons" SET
  "ropewiki_snapshot" = jsonb_build_object(
    'name', ropewiki_snapshot->>'name',
    'latitude', (ropewiki_snapshot->>'latitude')::double precision,
    'longitude', (ropewiki_snapshot->>'longitude')::double precision,
    'numAbseils', (ropewiki_snapshot->>'numAbseils')::int,
    'longestAbseil', (ropewiki_snapshot->>'longestAbseil')::double precision,
    'vGrade', (ropewiki_snapshot->'attributes'->>'v_grade')::int,
    'aGrade', (ropewiki_snapshot->'attributes'->>'a_grade')::int,
    'commitment', (ropewiki_snapshot->'attributes'->>'commitment')::int,
    'quality', (ropewiki_snapshot->'attributes'->>'quality')::int,
    'hours', (ropewiki_snapshot->'attributes'->>'hours')::double precision,
    'attributes', (ropewiki_snapshot->'attributes')::jsonb - ARRAY['v_grade','a_grade','commitment','quality','hours']
  )
WHERE "ropewiki_snapshot" IS NOT NULL;

-- Step 5: Drop redundant grade column
ALTER TABLE "canyons" DROP COLUMN "grade";
