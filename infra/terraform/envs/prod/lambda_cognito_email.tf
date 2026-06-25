# Cognito CustomEmailSender Lambda — sends verification codes via Resend so they
# land in the inbox (the COGNITO_DEFAULT sender mailed from an unaligned AWS
# domain and Gmail spam-binned every code; SES is unavailable — see cognito.tf).
#
# First Lambda and first KMS key in this root. The function source lives in
# infra/lambda/cognito-email-sender; build it before applying:
#   cd infra/lambda/cognito-email-sender && npm ci && npm run build
# archive_file zips the prebuilt dist/ — a stale/missing build will surface as a
# plan diff on source_code_hash.

locals {
  cognito_email_lambda_src = "${path.module}/../../../lambda/cognito-email-sender"
}

data "archive_file" "cognito_email_sender" {
  type        = "zip"
  source_dir  = "${local.cognito_email_lambda_src}/dist"
  output_path = "${path.module}/.build/cognito-email-sender.zip"
}

# ── KMS key Cognito uses to encrypt the code before invoking the Lambda ─────────
# Mandatory for CustomEmailSender. Cognito encrypts; the Lambda role decrypts.
resource "aws_kms_key" "cognito_email" {
  description             = "Encrypts Cognito CustomEmailSender verification codes"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AccountRootAdmin"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::620853681701:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "CognitoEncrypt"
        Effect    = "Allow"
        Principal = { Service = "cognito-idp.amazonaws.com" }
        Action    = ["kms:Encrypt", "kms:GenerateDataKey", "kms:Decrypt"]
        Resource  = "*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = "620853681701" }
        }
      },
      {
        Sid       = "LambdaDecrypt"
        Effect    = "Allow"
        Principal = { AWS = aws_iam_role.cognito_email_sender.arn }
        Action    = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource  = "*"
      },
    ]
  })
}

resource "aws_kms_alias" "cognito_email" {
  name          = "alias/logjam-cognito-email"
  target_key_id = aws_kms_key.cognito_email.key_id
}

# ── Lambda execution role ──────────────────────────────────────────────────────
resource "aws_iam_role" "cognito_email_sender" {
  name = "logjam-cognito-email-sender-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cognito_email_sender_basic" {
  role       = aws_iam_role.cognito_email_sender.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Decrypt the code (KMS CMK only) + read the Resend key (reuse the existing
# secret the ECS workers already use; see iam.tf:resend_api_key_access).
resource "aws_iam_role_policy" "cognito_email_sender" {
  name = "logjam-cognito-email-sender"
  role = aws_iam_role.cognito_email_sender.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DecryptCode"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.cognito_email.arn
      },
      {
        Sid      = "ReadResendKey"
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs*"
      },
    ]
  })
}

# ── Lambda function ────────────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "cognito_email_sender" {
  name              = "/aws/lambda/logjam-cognito-email-sender"
  retention_in_days = 14
}

resource "aws_lambda_function" "cognito_email_sender" {
  function_name    = "logjam-cognito-email-sender"
  role             = aws_iam_role.cognito_email_sender.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = data.archive_file.cognito_email_sender.output_path
  source_code_hash = data.archive_file.cognito_email_sender.output_base64sha256
  timeout          = 10
  memory_size      = 256

  environment {
    variables = {
      KMS_KEY_ARN       = aws_kms_key.cognito_email.arn
      EMAIL_FROM        = "noreply@notifications.logjamnsw.com"
      RESEND_SECRET_ARN = "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs"
    }
  }

  depends_on = [aws_cloudwatch_log_group.cognito_email_sender]
}

# Allow Cognito (this pool only) to invoke the function.
resource "aws_lambda_permission" "cognito_invoke" {
  statement_id  = "AllowCognitoInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cognito_email_sender.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
