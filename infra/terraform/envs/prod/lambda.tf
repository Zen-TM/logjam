# GeoPDF render Lambda. Replaces the on-demand Fargate worker
# (aws_ecs_task_definition.geo_pdf_worker, retained in ecs.tf until this is
# verified — see that file). POST /geo-pdf async-invokes this function
# (InvocationType "Event") via api/src/lib/lambdaInvoke.ts instead of RunTask;
# the function reuses the logjam-api container image with the entry_point
# overridden to the Lambda Runtime Interface Client (RIC, baked into the image
# by api/Dockerfile) and the command set to the handler.
#
# DEPLOY ORDER: this references logjam-api:latest, which must already contain
# dist/worker/geoPdfLambda.js (the new handler) and the RIC. Build + push the
# image via CI BEFORE `terraform apply` creates/updates this function. Image
# pushes after creation do NOT auto-update the function — re-apply or
# `aws lambda update-function-code` is required (same :latest caveat as ECS).

# Execution role. VPC access (ENI mgmt + CloudWatch Logs) via the AWS managed
# policy; DB secret + S3 reuse the same customer-managed policies the Fargate
# worker already uses (no new policy surface).
resource "aws_iam_role" "geo_pdf_lambda" {
  name = "logjam-geo-pdf-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "geo_pdf_lambda_vpc" {
  role       = aws_iam_role.geo_pdf_lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# secretsmanager:GetSecretValue on the RDS-managed secret — the Lambda resolves
# DB_USER/DB_PASSWORD from DB_SECRET_ID at startup (lib/resolveDbCredentials.ts),
# since it cannot use ECS secrets injection.
resource "aws_iam_role_policy_attachment" "geo_pdf_lambda_db_password" {
  role       = aws_iam_role.geo_pdf_lambda.name
  policy_arn = aws_iam_policy.database_password_access.arn
}

# S3 on logjam-topo-jobs (PutObject/DeleteObject for the rendered PDF) — the
# same policy the topo worker role carries. (It also grants SES, unused here;
# harmless and avoids a near-duplicate policy.)
resource "aws_iam_role_policy_attachment" "geo_pdf_lambda_s3" {
  role       = aws_iam_role.geo_pdf_lambda.name
  policy_arn = aws_iam_policy.topo_worker.arn
}

resource "aws_cloudwatch_log_group" "geo_pdf_lambda" {
  name              = "/aws/lambda/logjam-geo-pdf-worker"
  retention_in_days = 90
}

resource "aws_lambda_function" "geo_pdf_worker" {
  function_name = "logjam-geo-pdf-worker"
  role          = aws_iam_role.geo_pdf_lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.api.repository_url}:latest"
  memory_size   = 4096 # match the Fargate worker's 4GB (node-canvas render)
  timeout       = 300  # 5 min; render is ~27s, well under (and under the
  # GEO_PDF_RUNNING_TIMEOUT_MS reaper backstop)
  architectures = ["x86_64"]

  image_config {
    # Override the image ENTRYPOINT (EB's `node dist/boot.js`) with the RIC run
    # by its real entry path, and CMD with the handler. Invoking via the real
    # path (not the node_modules/.bin shim) is required — the shim's relative
    # ESM imports resolve from the wrong base (ERR_MODULE_NOT_FOUND). Verified
    # locally with the Lambda Runtime Interface Emulator. working_directory /app
    # so the handler path resolves against dist/.
    entry_point       = ["/usr/local/bin/node", "/app/node_modules/aws-lambda-ric/bin/index.mjs"]
    command           = ["dist/worker/geoPdfLambda.handler"]
    working_directory = "/app"
  }

  vpc_config {
    subnet_ids         = [data.aws_subnet.worker_a.id, data.aws_subnet.worker_b.id]
    security_group_ids = [aws_default_security_group.default.id]
  }

  # Mirrors the Fargate task def env (ecs.tf) so getEnv() validates identically
  # in production. DB credentials come from DB_SECRET_ID (resolved at startup),
  # not injected DB_USER/DB_PASSWORD. ECS_SUBNETS/ECS_SECURITY_GROUPS are set
  # only to satisfy the prod-required env check (lib/env.ts) — the Lambda never
  # launches Fargate tasks. AWS_REGION is intentionally omitted: it is a
  # reserved Lambda env var the runtime sets automatically (and rejects if set
  # here); the app reads it from process.env all the same.
  environment {
    variables = {
      AUTH_MODE            = "cognito"
      COGNITO_CLIENT_ID    = "545ofbb8l9d1sl6ggbmk6oonn9"
      COGNITO_REGION       = "ap-southeast-2"
      COGNITO_USER_POOL_ID = "ap-southeast-2_x5zPhJXMk"
      CORS_ORIGIN          = "https://logjamnsw.com,https://www.logjamnsw.com"
      DB_HOST              = "logjam-db.chwko8w4iz9p.ap-southeast-2.rds.amazonaws.com"
      DB_NAME              = "logjam"
      DB_PORT              = "5432"
      DB_SECRET_ID         = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:rds!db-6fa40c95-2bbc-4ee1-8f4e-de15c5abe3c4-4f8qWr"
      ECS_SECURITY_GROUPS  = "sg-0543d2bbce86b5d2a"
      ECS_SUBNETS          = "subnet-0f59b0845905891be,subnet-0c10e1438a8fd0231"
      NODE_ENV             = "production"
      S3_BUCKET_MEDIA      = "logjam-media"
      S3_BUCKET_TOPO       = "logjam-topo-jobs"
      TOPO_CDN_BASE_URL    = "https://logjamnsw.com"
    }
  }
}

# The API (Elastic Beanstalk instance role) must be allowed to invoke this
# function. That role (logjam-eb-role) is NOT otherwise managed by Terraform —
# this manages just the one inline policy on it (replacing the manual
# logjam-api-ecs-runtask grant's purpose for GeoPDF). Verify the role name
# matches the live EB instance-profile role before applying; a mismatch fails
# the plan safely (role not found).
resource "aws_iam_role_policy" "eb_invoke_geo_pdf_lambda" {
  name = "logjam-api-invoke-geo-pdf-lambda"
  role = "logjam-eb-role"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.geo_pdf_worker.arn
    }]
  })
}
