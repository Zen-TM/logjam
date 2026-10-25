-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

SELECT to_regclass('upgrade_check.baseline') IS NOT NULL AS applies \gset
\if :applies

CREATE TEMP TABLE after AS
SELECT * FROM (VALUES
  ('users',            (SELECT count(*) FROM users)),
  ('place_shares',     (SELECT count(*) FROM place_shares)),
  -- One row per pair, so the row count IS the pair count.
  ('friendship_pairs', (SELECT count(*) FROM friendships))
) AS t(metric, value);

\echo 'upgrade-check after head migrations (base -> after):'
SELECT b.metric, b.value AS base, a.value AS after,
       CASE WHEN a.value IS DISTINCT FROM b.value THEN 'MISMATCH' ELSE 'ok' END AS status
  FROM upgrade_check.baseline b LEFT JOIN after a USING (metric)
 ORDER BY status DESC, b.metric;

DO $$
DECLARE bad TEXT; weakened BIGINT;
BEGIN
  SELECT string_agg(format('%s: %s -> %s', b.metric, b.value, coalesce(a.value::text, 'missing')), '; ')
    INTO bad
    FROM upgrade_check.baseline b LEFT JOIN after a USING (metric)
   WHERE a.value IS DISTINCT FROM b.value;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'upgrade-check: data not carried across: %', bad;
  END IF;
  -- No pair lost its row, and none ended weaker than its strongest row was:
  -- a block is still a block, a friendship still a friendship.
  SELECT count(*) INTO weakened
    FROM upgrade_check.pair p
    LEFT JOIN friendships f
      ON LEAST(f.requester_id, f.addressee_id) = p.lo
     AND GREATEST(f.requester_id, f.addressee_id) = p.hi
   WHERE f.id IS NULL
      OR CASE f.status WHEN 'blocked' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END
         IS DISTINCT FROM p.strongest;
  IF weakened > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % pair(s) lost their friendship row or its status', weakened;
  END IF;
END $$;

-- Fixture-specific outcomes. Mutations: drop the merge and the migration
-- fails on CREATE INDEX; order the survivor by age alone and the lose-ab /
-- lose-ad rows are the ones kept; drop the promotion and keep-bc is still
-- pending with its prompt; drop the tombstone insert and the count is 0; drop the index and the insert at the bottom is accepted.
SELECT EXISTS (SELECT 1 FROM users WHERE id = 'upgrade-fixture-a') AS fixtures \gset
\if :fixtures
DO $$
DECLARE kept TEXT[]; notes TEXT[]; tombstones BIGINT; untouched BIGINT; promoted BIGINT;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO kept
    FROM friendships WHERE id LIKE 'upgrade-fixture-%';
  IF kept IS DISTINCT FROM ARRAY[
       'upgrade-fixture-keep-ac', 'upgrade-fixture-keep-ba', 'upgrade-fixture-keep-bc',
       'upgrade-fixture-keep-bd', 'upgrade-fixture-keep-da'] THEN
    RAISE EXCEPTION 'upgrade-check: wrong fixture friendships survived: %', kept;
  END IF;
  -- A survivor is not rewritten: phones already hold it as it is.
  SELECT count(*) INTO untouched
    FROM friendships WHERE id LIKE 'upgrade-fixture-%' AND updated_at < '2026-02-01';
  IF untouched <> 4 THEN
    RAISE EXCEPTION 'upgrade-check: expected 4 fixture survivors untouched, found %', untouched;
  END IF;
  -- Except the one that was two pending requests: accepted, and bumped for
  -- the delta pull.
  SELECT count(*) INTO promoted
    FROM friendships
   WHERE id = 'upgrade-fixture-keep-bc' AND status = 'accepted'
     AND requester_id = 'upgrade-fixture-b' AND updated_at > '2026-02-01';
  IF promoted <> 1 THEN
    RAISE EXCEPTION 'upgrade-check: two pending requests did not become one accepted friendship';
  END IF;
  SELECT array_agg(id || ' -> ' || (payload->>'friendshipId') ORDER BY id) INTO notes
    FROM notifications WHERE id LIKE 'upgrade-fixture-%';
  IF notes IS DISTINCT FROM ARRAY[
       'upgrade-fixture-keep-1 -> upgrade-fixture-keep-ba',
       'upgrade-fixture-move-1 -> upgrade-fixture-keep-ac'] THEN
    RAISE EXCEPTION 'upgrade-check: fixture notifications wrong: %', notes;
  END IF;
  -- Both people of each of the four merged rows are told to forget it.
  SELECT count(DISTINCT (user_id, entity_id)) INTO tombstones
    FROM sync_tombstones
   WHERE entity_type = 'friendship' AND entity_id LIKE 'upgrade-fixture-lose-%';
  IF tombstones <> 8 THEN
    RAISE EXCEPTION 'upgrade-check: expected 8 friendship tombstones, found %', tombstones;
  END IF;
  BEGIN
    INSERT INTO friendships (id, requester_id, addressee_id, status, updated_at)
    VALUES ('upgrade-fixture-second', 'upgrade-fixture-d', 'upgrade-fixture-b', 'pending', now());
    RAISE EXCEPTION 'upgrade-check: the pair index accepted a second row the other way round';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
\echo 'upgrade-check: fixture pairs merged, mutual requests accepted, notifications repointed, tombstones written, index refuses a second row'
\endif

DROP SCHEMA upgrade_check CASCADE;
\echo 'upgrade-check: data carried across'

\else
\echo 'upgrade-check: no baseline captured — release-specific checks skipped.'
\endif

-- Every user's storage is what it was less their live exports, never below 0.
-- Mutation: drop the migration's UPDATE and the fixture user stays at 5000
-- instead of 2500.
SELECT to_regclass('upgrade_check.export_uncharge') IS NOT NULL AS uncharge_applies \gset
\if :uncharge_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.export_uncharge c JOIN users u ON u.id = c.user_id
   WHERE u.storage_used_bytes IS DISTINCT FROM c.expected;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % user(s) not uncharged for their exports', bad;
  END IF;
END $$;
\endif
