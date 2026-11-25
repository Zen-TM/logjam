-- Launch limits (ADR 0003: this changes a default and a value, no shape).
-- Every account gets 800 compute credits and 10 GiB of downloads a month, the
-- overrides included: the maintainer asked for a blind drop. A new account
-- takes the column defaults below; the previous image still creates users
-- without naming the columns, so it gets them too. An account already past
-- 800 credits this month is refused its next launch, not stopped mid-run.
ALTER TABLE "users" ALTER COLUMN "monthly_compute_credits" SET DEFAULT 800;
ALTER TABLE "users" ALTER COLUMN "monthly_egress_quota_bytes" SET DEFAULT 10737418240;
UPDATE "users" SET "monthly_compute_credits" = 800, "monthly_egress_quota_bytes" = 10737418240;
