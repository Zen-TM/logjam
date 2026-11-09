-- The status timer's write, so an idle database still archives WAL every
-- minute. Run by boot.sh as the superuser in the `postgres` database; the
-- canary can only update its own one row. Safe to run again.
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE brain_canary LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brain_canary')
\gexec
ALTER ROLE brain_canary WITH PASSWORD :'canary_password';
-- A write a minute would fill the audit log with nothing worth reading.
ALTER ROLE brain_canary SET pgaudit.log = 'none';

CREATE SCHEMA IF NOT EXISTS brain;
CREATE TABLE IF NOT EXISTS brain.canary (id int PRIMARY KEY CHECK (id = 1), at timestamptz NOT NULL);
INSERT INTO brain.canary VALUES (1, now()) ON CONFLICT DO NOTHING;
GRANT USAGE ON SCHEMA brain TO brain_canary;
GRANT SELECT, UPDATE ON brain.canary TO brain_canary;

-- Only the application and the superuser connect to the database with user data.
REVOKE CONNECT ON DATABASE logjam FROM PUBLIC;
GRANT CONNECT ON DATABASE logjam TO logjam_app;
