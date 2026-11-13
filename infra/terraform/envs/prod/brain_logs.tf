# The brain's two container log groups, written by Docker's awslogs driver
# (retention: logging.tf).
locals {
  brain_log_group_api      = "/logjam/brain/api"
  brain_log_group_postgres = "/logjam/brain/postgres"
}

resource "aws_cloudwatch_log_group" "brain_api" {
  name              = local.brain_log_group_api
  retention_in_days = local.operational_log_retention_days
}

# Postgres's log, pgaudit lines included. It reaches the WORM bucket through
# the delivery stream in audit.tf, so what the brain's Postgres logs is
# tamper-evident. The stalled alarm in monitoring.tf watches that stream.
resource "aws_cloudwatch_log_group" "brain_postgres" {
  name              = local.brain_log_group_postgres
  retention_in_days = local.operational_log_retention_days
}

resource "aws_cloudwatch_log_subscription_filter" "brain_pgaudit_to_firehose" {
  name            = "logjam-brain-pgaudit-to-worm"
  log_group_name  = aws_cloudwatch_log_group.brain_postgres.name
  filter_pattern  = "" # all events
  destination_arn = aws_kinesis_firehose_delivery_stream.pgaudit.arn
  role_arn        = aws_iam_role.cwl_to_firehose.arn
}
