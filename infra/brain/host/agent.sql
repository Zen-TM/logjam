-- The one role every scheduled job connects as (status.sh's canary, pgBackRest
-- through pg1-user): local socket, no password, and no superuser. Run by
-- boot.sh as the superuser in the `postgres` database. Safe to run again.
-- It can run the backup and `check` functions, read settings, and update the
-- canary's one row: nothing else, and it cannot connect to the application's
-- database.
\set ON_ERROR_STOP on

SELECT 'CREATE ROLE brain_agent LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'brain_agent')
\gexec
-- A write and a backup call a minute would fill the audit log with nothing worth reading.
ALTER ROLE brain_agent SET pgaudit.log = 'none';

GRANT pg_read_all_settings TO brain_agent;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_start(text, boolean) TO brain_agent;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_backup_stop(boolean) TO brain_agent;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_create_restore_point(text) TO brain_agent;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_switch_wal() TO brain_agent;

CREATE SCHEMA IF NOT EXISTS brain;
CREATE TABLE IF NOT EXISTS brain.canary (id int PRIMARY KEY CHECK (id = 1), at timestamptz NOT NULL);
INSERT INTO brain.canary VALUES (1, now()) ON CONFLICT DO NOTHING;
GRANT USAGE ON SCHEMA brain TO brain_agent;
GRANT SELECT, UPDATE ON brain.canary TO brain_agent;

-- Only the application and the superuser connect to the database with user data.
REVOKE CONNECT ON DATABASE logjam FROM PUBLIC;
GRANT CONNECT ON DATABASE logjam TO logjam_app;
