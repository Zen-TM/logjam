-- A finished topo job keeps its own elapsed time (ADR 0003: this only adds).
-- topo_job_credits prices a finished job with no numeric wallSeconds from
-- updated_at - started_at, and updated_at moves on every later write to the
-- row, so renaming a failed job a week later charged its owner, and the site
-- pool, a week of 8 vCPUs more. The worker, the reaper, the cancel route and
-- the delete path each write `status` their own way, so the one place all of
-- them pass is a trigger: when a job leaves flight it records its elapsed
-- seconds as pipeline_metrics.wallSeconds, the field the charge and the
-- runtime estimate already prefer.

-- Rows already finished: the best end there is is the updated_at they hold now.
-- Raw SQL does not touch updated_at (Prisma sets it client-side), and the
-- trigger below does not exist yet. Only an object, JSON null or SQL NULL
-- takes a stamp; anything else in the column is left as it is.
UPDATE topo_jobs
SET pipeline_metrics = CASE WHEN jsonb_typeof(pipeline_metrics) = 'object'
      THEN pipeline_metrics ELSE '{}'::jsonb END
    || jsonb_build_object('wallSeconds',
         GREATEST(0, ROUND(EXTRACT(EPOCH FROM (updated_at - started_at))::numeric, 3)))
WHERE status NOT IN ('pending', 'processing')
  AND started_at IS NOT NULL
  AND COALESCE(jsonb_typeof(pipeline_metrics), 'null') IN ('null', 'object')
  AND jsonb_typeof(pipeline_metrics -> 'wallSeconds') IS DISTINCT FROM 'number';

CREATE FUNCTION stamp_topo_job_wall_seconds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('pending', 'processing')
     AND NEW.status NOT IN ('pending', 'processing')
     AND NEW.started_at IS NOT NULL
     AND COALESCE(jsonb_typeof(NEW.pipeline_metrics), 'null') IN ('null', 'object')
     AND jsonb_typeof(NEW.pipeline_metrics -> 'wallSeconds') IS DISTINCT FROM 'number'
  THEN
    -- started_at is timestamp(3) holding UTC: compare with NOW() in UTC, not in
    -- the session's zone.
    NEW.pipeline_metrics := CASE WHEN jsonb_typeof(NEW.pipeline_metrics) = 'object'
          THEN NEW.pipeline_metrics ELSE '{}'::jsonb END
        || jsonb_build_object('wallSeconds',
             GREATEST(0, ROUND(EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - NEW.started_at))::numeric, 3)));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- The accounting must never block a status write (the worker's, the reaper's,
  -- a cancel). No row value in the text: the Postgres log leaves the box.
  RAISE WARNING 'wallSeconds stamp skipped on update of %', TG_TABLE_NAME;
  RETURN NEW;
END
$$;

CREATE TRIGGER stamp_wall_seconds BEFORE UPDATE ON topo_jobs
  FOR EACH ROW EXECUTE FUNCTION stamp_topo_job_wall_seconds();
