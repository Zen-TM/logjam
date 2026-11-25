# The brain's instance role. Containers on the host use it through the
# instance metadata service (hop limit 2).
#
# It carries what the API uses: the secrets, the S3 grant, Cognito, the worker
# launch grant (with ecs:StopTask, which topoJobs.ts and topoJobReaper.ts
# call), the backup and signals buckets, image pull and the brain's two log
# groups. It leaves out the broad grants an instance role often carries:
#   - CloudWatchFullAccess, CloudWatchAgentServerPolicy: no agent runs; the
#     awslogs driver needs only CreateLogStream and PutLogEvents on two groups.
#   - AmazonEC2ContainerRegistryReadOnly: pull is scoped to two repositories.
#   - The database's master secret: the API runs as logjam_app.
#
# Only the inline policy below may be on the role: the exclusive resource
# undoes any other inline policy added by hand. Managed policies are not
# managed exclusively: AWS Budgets attaches the cost-ceiling deny to this role
# when spend passes the ceiling (budget_breaker.tf), and exclusive management
# would detach it at the next apply, lifting the block with nobody deciding
# to. Guards: tests/guards.tftest.hcl (brain_role_*).
resource "aws_iam_role" "brain" {
  name = "logjam-brain"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_instance_profile" "brain" {
  name = aws_iam_role.brain.name
  role = aws_iam_role.brain.name
}

# Session Manager's agent permissions. This managed policy is the AWS-documented
# set and is scoped to SSM and the message channels; not worth hand-listing.
resource "aws_iam_role_policy_attachment" "brain_ssm" {
  role       = aws_iam_role.brain.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policies_exclusive" "brain" {
  role_name    = aws_iam_role.brain.name
  policy_names = [aws_iam_role_policy.brain.name]
}

resource "aws_iam_role_policy" "brain" {
  name = "logjam-brain"
  role = aws_iam_role.brain.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The logjam_app credentials, the CloudFront origin-verify token and
        # the Resend API key (SMTP password). The Resend secret is made
        # outside Terraform, hence the literal ARN (as iam.tf).
        Sid    = "ReadOwnSecrets"
        Effect = "Allow"
        Action = "secretsmanager:GetSecretValue"
        Resource = [
          aws_secretsmanager_secret.app_db.arn,
          aws_secretsmanager_secret.origin_verify.arn,
          "arn:aws:secretsmanager:ap-southeast-2:620853681701:secret:logjam/resend-api-key-59egrs*",
        ]
      },
      {
        Sid      = "MediaAndTopoObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["arn:aws:s3:::logjam-media/*", "arn:aws:s3:::logjam-topo-jobs/*"]
      },
      {
        Sid      = "MediaAndTopoList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = ["arn:aws:s3:::logjam-media", "arn:aws:s3:::logjam-topo-jobs"]
      },
      {
        Sid      = "TopoInputMultipart"
        Effect   = "Allow"
        Action   = ["s3:ListMultipartUploadParts", "s3:AbortMultipartUpload"]
        Resource = "arn:aws:s3:::logjam-topo-jobs/inputs/*"
      },
      {
        Sid      = "TopoInputMultipartList"
        Effect   = "Allow"
        Action   = "s3:ListBucketMultipartUploads"
        Resource = "arn:aws:s3:::logjam-topo-jobs"
      },
      {
        # Read-only on purpose: the egress sweeper only sums bytes_sent.
        Sid      = "AccessLogsRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:ListBucket"]
        Resource = ["arn:aws:s3:::logjam-access-logs-620853681701", "arn:aws:s3:::logjam-access-logs-620853681701/*"]
      },
      {
        Sid      = "CognitoAdminUser"
        Effect   = "Allow"
        Action   = ["cognito-idp:AdminGetUser", "cognito-idp:AdminDeleteUser"]
        Resource = "arn:aws:cognito-idp:ap-southeast-2:620853681701:userpool/ap-southeast-2_x5zPhJXMk"
      },
      {
        Sid    = "RunWorkerTasks"
        Effect = "Allow"
        Action = "ecs:RunTask"
        Resource = [
          "arn:aws:ecs:ap-southeast-2:620853681701:task-definition/logjam-topo-worker:*",
          "arn:aws:ecs:ap-southeast-2:620853681701:task-definition/logjam-topo-export-worker:*",
        ]
      },
      {
        Sid      = "StopWorkerTasks"
        Effect   = "Allow"
        Action   = "ecs:StopTask"
        Resource = "arn:aws:ecs:ap-southeast-2:620853681701:task/${aws_ecs_cluster.main.name}/*"
      },
      {
        Sid      = "PassWorkerRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = [aws_iam_role.topo_worker.arn, aws_iam_role.ecs_task_execution.arn]
        Condition = {
          StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" }
        }
      },
      {
        # pgBackRest's repository: list, read, write and delete, on this bucket.
        # The version actions let `--repo-target-time` read the bucket as of a
        # past time. Never DeleteObjectVersion (pgBackRest's expire only adds
        # delete markers) nor the retention-bypass actions: the lock is what
        # protects the backups from this role.
        Sid      = "BackupRepositoryList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketVersions"]
        Resource = aws_s3_bucket.brain_backups.arn
      },
      {
        Sid      = "BackupRepositoryObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.brain_backups.arn}/*"
      },
      {
        # The brain reads the release and writes its own status. It cannot
        # write the release: CI decides what runs, not the host.
        Sid      = "SignalsRead"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.brain_signals.arn}/release.json"
      },
      {
        Sid      = "SignalsWriteStatus"
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.brain_signals.arn}/status.json"
      },
      {
        # Without it S3 answers 403, not 404, for an object that is not there
        # yet (no release.json before the first deploy). Key names only.
        Sid      = "SignalsList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.brain_signals.arn
      },
      {
        # No resource-level permission.
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPull"
        Effect = "Allow"
        Action = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = [
          aws_ecr_repository.api.arn,
          aws_ecr_repository.brain_postgres.arn,
        ]
      },
      {
        Sid      = "BrainLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [for g in [local.brain_log_group_api, local.brain_log_group_postgres] : "arn:aws:logs:ap-southeast-2:620853681701:log-group:${g}:*"]
      },
    ]
  })
}
