# Least-privilege application database role.
#
# Dedicated, non-superuser, schema-owning role (logjam_app) so that:
#   - the API runs with least privilege (blast-radius reduction), and
#   - the operator's honest path (the superuser's `psql`) is DISTINCT from API
#     traffic in the pgaudit logs (audit.tf / brain_logs.tf).
#
# This file only creates the SECRET CONTAINER and the read grants. Creating the
# role itself is SQL (infra/brain/host/bootstrap-app-db-role.sql, run by the
# brain's first boot).
#
# The password VALUE is deliberately NOT managed here: Terraform never sees it
# (kept out of state). The operator sets the version. Shape must match what the
# app parses: {"username":"logjam_app","password":"..."} (see
# api/src/lib/resolveDbCredentials.ts).

resource "aws_secretsmanager_secret" "app_db" {
  name        = "logjam/app-db-password"
  description = "Credentials for the least-privilege application DB role (logjam_app)."
}

# Lets the ECS task execution role inject logjam_app credentials into the worker
# task defs at launch. The brain's role reads the same secret (brain_iam.tf).
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

