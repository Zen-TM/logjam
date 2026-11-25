-- Deleting a finished job must not erase the compute it used (ADR 0003: this
-- only adds). Usage of rows that exist stays derived from the job tables; what
-- a delete would lose is carried over into these two tables by a trigger, and
-- the SQL that prices a job is written once, in the two functions below, for
-- the usage query and the trigger alike.

CREATE TABLE "compute_usage_carryover" (
    "user_id" TEXT NOT NULL,
    "month_start" TIMESTAMP(3) NOT NULL,
    "credits" BIGINT NOT NULL,

    CONSTRAINT "compute_usage_carryover_pkey" PRIMARY KEY ("user_id","month_start")
);

CREATE TABLE "site_compute_carryover" (
    "month_start" TIMESTAMP(3) NOT NULL,
    "credits" BIGINT NOT NULL,

    CONSTRAINT "site_compute_carryover_pkey" PRIMARY KEY ("month_start")
);

ALTER TABLE "compute_usage_carryover" ADD CONSTRAINT "compute_usage_carryover_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Credits (vCPU-minutes) of one job, rounded up. The vCPU counts are the
-- WORKER_SPECS in shared/src/computeCredits.ts. Only a job in flight (the
-- statuses lib/fargateCapacity.ts calls in flight) is measured against NOW():
-- a finished row keeps the end it was left with, so a reaped job stops costing.
-- Total on any row: a wallSeconds that is not a number, or is absurd, is
-- ignored rather than raised, because the usage query runs these over every
-- account on every submission.
CREATE FUNCTION topo_job_credits(status text, pipeline_metrics jsonb, started_at timestamp, updated_at timestamp)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CEIL(
    8::numeric * COALESCE(
      CASE WHEN jsonb_typeof(pipeline_metrics -> 'wallSeconds') = 'number'
        THEN LEAST((pipeline_metrics ->> 'wallSeconds')::numeric, 31536000) END,
      EXTRACT(EPOCH FROM (
        CASE WHEN status IN ('pending', 'processing') THEN NOW() ELSE updated_at END
        - started_at
      ))
    ) / 60.0
  )
$$;

-- topo_export_jobs has no updated_at, so a finished export with no completed_at
-- (one a reaper failed before it stamped it) costs nothing beyond its start.
CREATE FUNCTION topo_export_job_credits(status text, completed_at timestamp, started_at timestamp)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CEIL(4::numeric * EXTRACT(EPOCH FROM (
    CASE WHEN status IN ('queued', 'running') THEN COALESCE(completed_at, NOW())
         ELSE COALESCE(completed_at, started_at) END
    - started_at
  )) / 60.0)
$$;

-- The start of the Sydney month a job started in, as the UTC timestamp
-- currentMonthStart() in shared/src/monthlyQuota.ts gives for it.
CREATE FUNCTION compute_month_start(ts timestamp)
RETURNS timestamp LANGUAGE sql IMMUTABLE AS $$
  SELECT (date_trunc('month', ts AT TIME ZONE 'UTC' AT TIME ZONE 'Australia/Sydney')
          AT TIME ZONE 'Australia/Sydney') AT TIME ZONE 'UTC'
$$;

-- Adds a deleted job's credits to the site row and to its owner's. No owner row
-- when the owner is already gone (an account delete cascading to its jobs), or
-- the foreign key would refuse it; the site row still counts the month.
CREATE FUNCTION add_compute_carryover(p_user_id text, p_started_at timestamp, p_credits numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_month timestamp := compute_month_start(p_started_at);
  v_credits bigint := GREATEST(p_credits, 0)::bigint;
BEGIN
  IF v_credits = 0 THEN RETURN; END IF;
  INSERT INTO site_compute_carryover (month_start, credits) VALUES (v_month, v_credits)
    ON CONFLICT (month_start) DO UPDATE
    SET credits = site_compute_carryover.credits + EXCLUDED.credits;
  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    INSERT INTO compute_usage_carryover (user_id, month_start, credits) VALUES (p_user_id, v_month, v_credits)
      ON CONFLICT (user_id, month_start) DO UPDATE
      SET credits = compute_usage_carryover.credits + EXCLUDED.credits;
  END IF;
END
$$;

CREATE FUNCTION carry_over_topo_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.started_at IS NOT NULL THEN
    PERFORM add_compute_carryover(OLD.user_id, OLD.started_at,
      topo_job_credits(OLD.status, OLD.pipeline_metrics, OLD.started_at, OLD.updated_at));
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- The accounting must never block a delete (a user's, a sweep's, an account's).
  -- No row value in the text: the Postgres log leaves the box.
  RAISE WARNING 'compute carry-over skipped on delete from %', TG_TABLE_NAME;
  RETURN OLD;
END
$$;

CREATE FUNCTION carry_over_topo_export_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.started_at IS NOT NULL THEN
    PERFORM add_compute_carryover(OLD.user_id, OLD.started_at,
      topo_export_job_credits(OLD.status, OLD.completed_at, OLD.started_at));
  END IF;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- The accounting must never block a delete (a user's, a sweep's, an account's).
  -- No row value in the text: the Postgres log leaves the box.
  RAISE WARNING 'compute carry-over skipped on delete from %', TG_TABLE_NAME;
  RETURN OLD;
END
$$;

CREATE TRIGGER carry_over_compute BEFORE DELETE ON topo_jobs
  FOR EACH ROW EXECUTE FUNCTION carry_over_topo_job();
CREATE TRIGGER carry_over_compute BEFORE DELETE ON topo_export_jobs
  FOR EACH ROW EXECUTE FUNCTION carry_over_topo_export_job();
