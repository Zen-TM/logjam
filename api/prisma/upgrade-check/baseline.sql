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
-- RELEASE-SPECIFIC. The metrics below describe
-- 20261012120000_friendships_one_per_pair, which merges a pair's reciprocal
-- friendship rows into one before indexing the pair. They switch themselves
-- off once the base schema has that index; the next release that moves data
-- replaces them. The generic half (migrations apply over real rows; the result
-- matches schema.prisma) lives in the script and never goes stale.
--
-- `-v fixtures=1` first inserts what the seed does not have: pairs with a row
-- each way round, in every mix of statuses, and the notifications that name
-- them. CI only — never against a prod copy.

\set ON_ERROR_STOP on

SELECT to_regclass('public.friendships_pair_key') IS NULL AS applies \gset
\if :applies

\if :{?fixtures}
INSERT INTO users (id, cognito_id, username, email) VALUES
  ('upgrade-fixture-a', 'upgrade-fixture-a-sub', 'upgrade_a', 'a@upgrade.invalid'),
  ('upgrade-fixture-b', 'upgrade-fixture-b-sub', 'upgrade_b', 'b@upgrade.invalid'),
  ('upgrade-fixture-c', 'upgrade-fixture-c-sub', 'upgrade_c', 'c@upgrade.invalid'),
  ('upgrade-fixture-d', 'upgrade-fixture-d-sub', 'upgrade_d', 'd@upgrade.invalid');

-- The id says what should happen to the row: keep-* survives, lose-* goes.
INSERT INTO friendships (id, requester_id, addressee_id, status, created_at, updated_at) VALUES
  -- accepted beats an OLDER pending
  ('upgrade-fixture-lose-ab', 'upgrade-fixture-a', 'upgrade-fixture-b', 'pending',  '2026-01-01', '2026-01-01'),
  ('upgrade-fixture-keep-ba', 'upgrade-fixture-b', 'upgrade-fixture-a', 'accepted', '2026-01-02', '2026-01-02'),
  -- two accepted: the older
  ('upgrade-fixture-keep-ac', 'upgrade-fixture-a', 'upgrade-fixture-c', 'accepted', '2026-01-01', '2026-01-01'),
  ('upgrade-fixture-lose-ca', 'upgrade-fixture-c', 'upgrade-fixture-a', 'accepted', '2026-01-02', '2026-01-02'),
  -- two pending: the older
  ('upgrade-fixture-keep-bc', 'upgrade-fixture-b', 'upgrade-fixture-c', 'pending',  '2026-01-01', '2026-01-01'),
  ('upgrade-fixture-lose-cb', 'upgrade-fixture-c', 'upgrade-fixture-b', 'pending',  '2026-01-02', '2026-01-02'),
  -- a block beats an OLDER accepted
  ('upgrade-fixture-lose-ad', 'upgrade-fixture-a', 'upgrade-fixture-d', 'accepted', '2026-01-01', '2026-01-01'),
  ('upgrade-fixture-keep-da', 'upgrade-fixture-d', 'upgrade-fixture-a', 'blocked',  '2026-01-02', '2026-01-02'),
  -- a pair with one row is left alone
  ('upgrade-fixture-keep-bd', 'upgrade-fixture-b', 'upgrade-fixture-d', 'accepted', '2026-01-01', '2026-01-01');

-- Same convention: keep-* stays as written, lose-* is deleted, and move-*
-- stays but now names the surviving row.
INSERT INTO notifications (id, user_id, type, payload) VALUES
  ('upgrade-fixture-lose-1', 'upgrade-fixture-b', 'friend_request',          '{"friendshipId": "upgrade-fixture-lose-ab", "requesterId": "upgrade-fixture-a"}'),
  ('upgrade-fixture-keep-1', 'upgrade-fixture-b', 'friend_request_accepted', '{"friendshipId": "upgrade-fixture-keep-ba", "acceptedById": "upgrade-fixture-a"}'),
  ('upgrade-fixture-move-1', 'upgrade-fixture-c', 'friend_request_accepted', '{"friendshipId": "upgrade-fixture-lose-ca", "acceptedById": "upgrade-fixture-a"}'),
  ('upgrade-fixture-keep-2', 'upgrade-fixture-c', 'friend_request',          '{"friendshipId": "upgrade-fixture-keep-bc", "requesterId": "upgrade-fixture-b"}'),
  ('upgrade-fixture-lose-2', 'upgrade-fixture-b', 'friend_request',          '{"friendshipId": "upgrade-fixture-lose-cb", "requesterId": "upgrade-fixture-c"}'),
  ('upgrade-fixture-lose-3', 'upgrade-fixture-a', 'friend_request_accepted', '{"friendshipId": "upgrade-fixture-lose-ad", "acceptedById": "upgrade-fixture-d"}');
\endif

DROP SCHEMA IF EXISTS upgrade_check CASCADE;
CREATE SCHEMA upgrade_check;

-- Every pair that had a row, and the strongest thing any of its rows said
-- (0 blocked, 1 accepted, 2 pending). The merge must leave each pair exactly
-- one row, saying that.
CREATE TABLE upgrade_check.pair AS
SELECT LEAST(requester_id, addressee_id) AS lo,
       GREATEST(requester_id, addressee_id) AS hi,
       min(CASE status WHEN 'blocked' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END) AS strongest,
       count(*) AS row_count
  FROM friendships
 GROUP BY 1, 2;

CREATE TABLE upgrade_check.baseline AS
SELECT * FROM (VALUES
  ('users',            (SELECT count(*) FROM users)),
  ('place_shares',     (SELECT count(*) FROM place_shares)),
  ('friendship_pairs', (SELECT count(*) FROM upgrade_check.pair))
) AS t(metric, value);

\echo 'upgrade-check baseline captured:'
SELECT metric, value FROM upgrade_check.baseline ORDER BY metric;
\echo 'pairs with more than one friendship row (the merge will fold these):'
SELECT count(*) AS pairs, coalesce(sum(row_count - 1), 0) AS rows_to_go
  FROM upgrade_check.pair WHERE row_count > 1;

\else
\echo 'upgrade-check: base already has the friendship pair index — these checks no longer apply; replace them for this release.'
\endif
