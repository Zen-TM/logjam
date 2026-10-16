# Least-privilege application database role.
#
# Dedicated, non-superuser, schema-owning role (logjam_app) so that:
#   - the API runs with least privilege (blast-radius reduction), and
#   - the operator's honest path (master `psql`) is DISTINCT from API traffic in
#     the pgaudit logs (audit.tf / rds.tf).
#
# This file only creates the SECRET CONTAINER and the read grant. Creating the
# role itself is SQL (scripts/bootstrap-app-db-role.sql, run once as master) and
# pointing the app at it (EB DB_SECRET_ID + ECS task-def secret refs) is an
# operator-gated cutover.
#
# The password VALUE is deliberately NOT managed here — mirroring the
# RDS-managed master secret, Terraform never sees it (kept out of state). The
# operator sets the version during cutover. Shape must match what the app
# parses: {"username":"logjam_app","password":"..."} (see
# api/src/lib/resolveDbCredentials.ts).

resource "aws_secretsmanager_secret" "app_db" {
  name        = "logjam/app-db-password"
  description = "Credentials for the least-privilege application DB role (logjam_app)."
}

# Lets the ECS task execution role inject logjam_app credentials into the worker
# task defs at launch (mirrors aws_iam_policy.database_password_access for the
# master secret). The EB API container reads it via DB_SECRET_ID at boot.
resource "aws_iam_policy" "app_db_password_access" {
  name = "AppDatabasePasswordAccess"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.app_db.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_exec_app_db_password" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = aws_iam_policy.app_db_password_access.arn
}

# EB instance role (logjam-eb-role) — the EB API container resolves logjam_app
# credentials from DB_SECRET_ID at boot (api/src/boot.ts ->
# api/src/lib/resolveDbCredentials.ts) and re-resolves the password per
# connection (api/src/lib/dbPassword.ts), so the EB instances need
# GetSecretValue on the new secret. The role is EB-managed (created with the
# environment, not by this config), so it is referenced by name rather than as a
# resource; the attachment itself is tracked here so the grant is part of the
# committed proof artifact. This MUST be applied before the EB env is cut over
# to the new DB_SECRET_ID, or boot.ts fails closed (exit 1) unable to read the
# secret.
resource "aws_iam_role_policy_attachment" "eb_instance_app_db_password" {
  role       = "logjam-eb-role"
  policy_arn = aws_iam_policy.app_db_password_access.arn
}
