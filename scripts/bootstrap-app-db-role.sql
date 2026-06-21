-- Least-privilege application database role (operator-trust-plan Part D).
--
-- Run ONCE as the master user (logjam_admin) against the prod database, during
-- the operator-gated cutover. See docs/operator-trust-runbook.md for the full
-- sequence and how to obtain :app_password.
--
-- Usage (psql variable substitution keeps the password off the command line /
-- shell history — supply it via a prompt or an env var, never inline):
--   psql "host=... dbname=logjam user=logjam_admin" \
--     -v app_password="$(aws secretsmanager get-secret-value ... | jq -r .password)" \
--     -f scripts/bootstrap-app-db-role.sql
--
-- The role is intentionally NOT a superuser and cannot create roles/databases.
-- It OWNS the public schema so that `prisma migrate deploy` (run by the app at
-- container start, api/src/boot.ts) can still issue DDL on its own tables.

\set ON_ERROR_STOP on

-- 1. Create the login role (no-op if it already exists, but keep the password
--    in sync from the secret on every run).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'logjam_app') THEN
    EXECUTE format(
      'CREATE ROLE logjam_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
      :'app_password'
    );
  ELSE
    EXECUTE format('ALTER ROLE logjam_app WITH PASSWORD %L', :'app_password');
  END IF;
END
$$;

-- 2. Audit cost vs. signal: drop READ logging for the application role only.
--    The global pgaudit.log (logjam-pg16-pgaudit param group) is
--    "read,write,ddl,role", so OPERATOR/master sessions still log reads — that
--    is the privacy point. But logjam_app's normal traffic (reaper polling,
--    per-request reads) is high-volume and carries zero operator-access signal,
--    so logging it just inflates CloudWatch Logs ingestion cost. This per-role
--    override keeps the app's writes/DDL audited while suppressing its reads.
--    Operator reads stay fully recorded; the residual "operator connects AS
--    logjam_app to dodge read-logging" gap is made visible by log_connections
--    (every connection's role + source is logged to the WORM sink). Documented
--    in docs/DATA-ACCESS-POLICY.md. Takes effect on the role's next session.
ALTER ROLE logjam_app SET pgaudit.log = 'write, ddl, role';

-- 3. Hand the application its own schema so migrate deploy can run DDL without
--    superuser. (Postgres lets a role do anything within a schema it owns.)
ALTER SCHEMA public OWNER TO logjam_app;

-- 4. Privileges on EVERYTHING already in the schema (tables created while the
--    schema was owned by the master user).
GRANT USAGE, CREATE ON SCHEMA public TO logjam_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO logjam_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO logjam_app;

-- 5. And on everything created in future (covers tables added by later
--    migrations, whoever creates them).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO logjam_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO logjam_app;

-- 6. Confirm it is NOT a superuser (the whole point).
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname = 'logjam_app';
