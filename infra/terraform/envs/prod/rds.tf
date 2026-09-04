# Primary Postgres database. Imported from the live instance. The master
# password is RDS-managed (manage_master_user_password) and rotated into the
# rds!db-... Secrets Manager secret — the app re-resolves it per connection
# (api/src/lib/dbPassword.ts), so Terraform must never own/replace it.
#
# prevent_destroy guards Terraform from destroying it; deletion_protection
# guards AWS-side too. backup_retention_period = 7 enables daily snapshots +
# point-in-time recovery (the live instance shipped with 0 = no backups).
resource "aws_db_instance" "main" {
  allocated_storage               = 20
  apply_immediately               = true
  auto_minor_version_upgrade      = false
  availability_zone               = "ap-southeast-2a"
  backup_retention_period         = 7
  backup_target                   = "region"
  backup_window                   = "16:32-17:02"
  ca_cert_identifier              = "rds-ca-rsa2048-g1"
  copy_tags_to_snapshot           = true
  customer_owned_ip_enabled       = false
  database_insights_mode          = "standard"
  db_name                         = "logjam"
  db_subnet_group_name            = "logjam-db-subnet-group"
  dedicated_log_volume            = false
  delete_automated_backups        = false
  deletion_protection             = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
  engine                          = "postgres"
  # Enrolled in RDS Extended Support. The original logjam-db had this DISABLED
  # (set at its creation), but engine_lifecycle_support is a create/restore-time
  # setting — restore-db-instance-from-db-snapshot defaulted logjam-db-enc to
  # enrolled and AWS rejects flipping it via ModifyDBInstance. No charge while
  # Postgres 16 is in standard support; Extended Support billing would only start
  # at PG16 EOL (~Nov 2027). Revisit before then (a fresh restore with the flag
  # disabled is the only way to opt out) rather than re-migrate now.
  engine_lifecycle_support            = "open-source-rds-extended-support"
  engine_version                      = "16.13"
  iam_database_authentication_enabled = true
  identifier                          = "logjam-db-enc"
  instance_class                      = "db.t3.micro"
  license_model                       = "postgresql-license"
  maintenance_window                  = "thu:17:37-thu:18:07"
  manage_master_user_password         = true
  # Storage autoscaling: grow allocated_storage (20 GB) up to 100 GB on demand.
  # Costs nothing until it actually grows — billed on provisioned GB, not the cap
  # — and removes the only hard-outage risk in the DB tier (gp2, no cushion).
  # RDS autoscaling only grows, never shrinks.
  max_allocated_storage        = 100
  monitoring_interval          = 0
  multi_az                     = false
  network_type                 = "IPV4"
  option_group_name            = "default:postgres-16"
  parameter_group_name         = aws_db_parameter_group.pgaudit.name
  performance_insights_enabled = false
  port                         = 5432
  publicly_accessible          = false
  skip_final_snapshot          = false
  # INF-007: belt-and-suspenders behind prevent_destroy + deletion_protection —
  # both already guard against an accidental terraform destroy or console
  # delete, but neither guards a *deliberate* one from losing everything. A
  # static identifier is fine: this only matters if the instance is actually
  # ever deleted, at which point whoever is running that delete picks a fresh
  # name if this one is taken.
  final_snapshot_identifier = "logjam-db-enc-final"
  storage_encrypted         = true
  kms_key_id                = "arn:aws:kms:ap-southeast-2:620853681701:key/abe78b2a-98e6-40a6-bafc-b8b4c2e7d577"
  # gp3, not gp2: cheaper per GB AND faster at this size. gp2 derives IOPS from
  # volume size (3 IOPS/GB — just 60 provisioned IOPS on a 20 GB volume, leaning
  # on burst credits), while gp3's 3000 IOPS baseline is included at no extra
  # cost below 400 GB. The switch is an online ModifyDBInstance with no
  # downtime, though the volume spends a while in `optimizing` afterwards.
  storage_type           = "gp3"
  username               = "logjam_admin"
  vpc_security_group_ids = ["sg-06cc0aaa310968aa4"]

  lifecycle {
    prevent_destroy = true
    # RDS does not return manage_master_user_password readably on import, so it
    # perpetually shows as a diff. The password is RDS-managed regardless of
    # this attribute; ignoring it avoids a needless ModifyDBInstance against the
    # live master secret the whole app depends on.
    ignore_changes = [manage_master_user_password]
  }
}

# pgaudit parameter group (operator-trust-plan Part C). Replaces the default
# parameter group so we can preload pgaudit and capture direct SQL.
#
# IMPORTANT — applying this is NOT zero-downtime:
#  - shared_preload_libraries is a STATIC parameter: it takes effect only after a
#    DB REBOOT. Attaching this group + the reboot is an operator-gated step.
#  - After the reboot, run `CREATE EXTENSION IF NOT EXISTS pgaudit;` once as the
#    master user (see the operator-trust runbook) so the pgaudit.* settings
#    below take effect.
#
# Privacy: pgaudit.log_parameter = 0 keeps bound query parameters OUT of the
# logs. Prisma uses parameterized queries, so the logged statement text is
# placeholders ($1, $2 …), never literal coordinates or canyon names — this is
# what keeps the audit logs compliant with the "no coords/names in plaintext
# logs" rule while still recording WHO read WHAT tables WHEN.
#
# Cost vs. signal: the GLOBAL pgaudit.log below is "read,write,ddl,role", so any
# OPERATOR/master session (logjam_admin) logs reads too — that is the privacy
# point. But the application connects as the least-privilege role logjam_app,
# whose normal traffic (reaper polling, per-request reads) is high-volume and
# carries zero operator-access signal. So logjam_app gets a PER-ROLE override
# that drops read logging (see scripts/bootstrap-app-db-role.sql:
# `ALTER ROLE logjam_app SET pgaudit.log = 'write, ddl, role'`). App writes/DDL
# stay logged; app reads do not. This cuts the dominant CloudWatch Logs
# ingestion cost while leaving operator reads fully recorded.
#
# The residual gap (an operator could connect AS logjam_app to read with reads
# suppressed) is made visible by log_connections = 1 below: every new connection
# — role, source address, application — is recorded to the same WORM sink, so a
# logjam_app session from a non-app source is anomalous and on record. This is
# documented honestly in docs/DATA-ACCESS-POLICY.md.
resource "aws_db_parameter_group" "pgaudit" {
  name        = "logjam-pg16-pgaudit"
  family      = "postgres16"
  description = "Postgres 16 with pgaudit enabled (operator-access auditing)."

  parameter {
    name         = "shared_preload_libraries"
    value        = "pgaudit"
    apply_method = "pending-reboot"
  }

  # Global default: operator/master sessions log reads too. The app role
  # overrides this per-role to drop reads (bootstrap-app-db-role.sql).
  parameter {
    name  = "pgaudit.log"
    value = "read,write,ddl,role"
  }

  # Keep bound parameter values (coords/names) out of the audit log.
  parameter {
    name  = "pgaudit.log_parameter"
    value = "0"
  }

  # Cut catalog-read noise (system tables), keeping the signal on user data.
  parameter {
    name  = "pgaudit.log_catalog"
    value = "0"
  }

  # Record every connection (role + source address + application name) to the
  # postgresql log -> WORM sink. Cheap (one line per connect, not per query) and
  # makes an operator connecting as logjam_app to dodge read-logging visible.
  parameter {
    name  = "log_connections"
    value = "1"
  }
}
