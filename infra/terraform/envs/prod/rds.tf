# Primary Postgres database. Imported from the live instance. The master
# password is RDS-managed (manage_master_user_password) and rotated into the
# rds!db-... Secrets Manager secret — the app re-resolves it per connection
# (api/src/lib/dbPassword.ts), so Terraform must never own/replace it.
#
# prevent_destroy guards Terraform from destroying it; deletion_protection
# guards AWS-side too. backup_retention_period = 7 enables daily snapshots +
# point-in-time recovery (the live instance shipped with 0 = no backups).
resource "aws_db_instance" "main" {
  allocated_storage                   = 20
  apply_immediately                   = true
  auto_minor_version_upgrade          = false
  availability_zone                   = "ap-southeast-2a"
  backup_retention_period             = 7
  backup_target                       = "region"
  backup_window                       = "16:32-17:02"
  ca_cert_identifier                  = "rds-ca-rsa2048-g1"
  copy_tags_to_snapshot               = true
  customer_owned_ip_enabled           = false
  database_insights_mode              = "standard"
  db_name                             = "logjam"
  db_subnet_group_name                = "logjam-db-subnet-group"
  dedicated_log_volume                = false
  delete_automated_backups            = true
  deletion_protection                 = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]
  engine                              = "postgres"
  engine_lifecycle_support            = "open-source-rds-extended-support-disabled"
  engine_version                      = "16.13"
  iam_database_authentication_enabled = true
  identifier                          = "logjam-db"
  instance_class                      = "db.t3.micro"
  license_model                       = "postgresql-license"
  maintenance_window                  = "thu:17:37-thu:18:07"
  manage_master_user_password         = true
  max_allocated_storage               = 0
  monitoring_interval                 = 0
  multi_az                            = false
  network_type                        = "IPV4"
  option_group_name                   = "default:postgres-16"
  parameter_group_name                = aws_db_parameter_group.pgaudit.name
  performance_insights_enabled        = false
  port                                = 5432
  publicly_accessible                 = false
  skip_final_snapshot                 = true
  storage_encrypted                   = false
  storage_type                        = "gp2"
  username                            = "logjam_admin"
  vpc_security_group_ids              = ["sg-06cc0aaa310968aa4"]

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
resource "aws_db_parameter_group" "pgaudit" {
  name        = "logjam-pg16-pgaudit"
  family      = "postgres16"
  description = "Postgres 16 with pgaudit enabled (operator-access auditing)."

  parameter {
    name         = "shared_preload_libraries"
    value        = "pgaudit"
    apply_method = "pending-reboot"
  }

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
}
