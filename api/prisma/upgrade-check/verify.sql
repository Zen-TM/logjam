-- Migration UPGRADE check, part 2 of 2: runs after the head's migrations, and
-- compares against what baseline.sql captured. See baseline.sql for why and
-- for when these release-specific metrics are replaced. Fails (exit 3) listing
-- EVERY mismatch, not just the first.

\set ON_ERROR_STOP on

-- A finished job that started carries a numeric wallSeconds: its own when it
-- had one, else updated_at - started_at as baseline.sql saw it; the others
-- keep their metrics; no updated_at moved. Mutation: drop the backfill UPDATE
-- (a null-metrics job gets no wallSeconds), or drop its numeric-wallSeconds
-- condition (fixture 4 is overwritten).
SELECT to_regclass('upgrade_check.topo_jobs') IS NOT NULL AS stamp_applies \gset
\if :stamp_applies
DO $$
DECLARE bad BIGINT;
BEGIN
  SELECT count(*) INTO bad
    FROM upgrade_check.topo_jobs b LEFT JOIN topo_jobs j ON j.id = b.id
   WHERE j.id IS NULL
      OR j.updated_at IS DISTINCT FROM b.updated_at
      OR CASE
           WHEN b.started_at IS NULL
             OR COALESCE(jsonb_typeof(b.pipeline_metrics), 'null') NOT IN ('null', 'object')
             THEN j.pipeline_metrics IS DISTINCT FROM b.pipeline_metrics
           WHEN jsonb_typeof(b.pipeline_metrics -> 'wallSeconds') = 'number'
             THEN j.pipeline_metrics IS DISTINCT FROM b.pipeline_metrics
           ELSE jsonb_typeof(j.pipeline_metrics -> 'wallSeconds') IS DISTINCT FROM 'number'
             OR abs((j.pipeline_metrics ->> 'wallSeconds')::numeric
                    - GREATEST(0, EXTRACT(EPOCH FROM (b.updated_at - b.started_at)))) > 0.001
         END;
  IF bad > 0 THEN
    RAISE EXCEPTION 'upgrade-check: % finished topo job(s) were not backfilled as the migration says', bad;
  END IF;
END $$;
DROP SCHEMA upgrade_check CASCADE;
\endif
