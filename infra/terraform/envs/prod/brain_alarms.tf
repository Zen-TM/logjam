# The brain's instance alarms, on the same topic as the rest
# (monitoring.tf), each created only when the instance is. What fires each one
# and what to do first: docs/operations/alarms.md. Guard:
# tests/guards.tftest.hcl (brain_alarms_act_on_the_instance).

# EC2 recovers an instance with a failed system check by itself by default
# (maintenance_options in brain_instance.tf); this alarm adds the email. Same
# host, same disks, same address.
resource "aws_cloudwatch_metric_alarm" "brain_system_status_failed" {
  count = local.brain_enabled ? 1 : 0

  alarm_name        = "logjam-brain-system-status-failed"
  alarm_description = "The brain's AWS system status check failed for 2 minutes; EC2 is recovering it onto new hardware. First: wait for the OK email, then check the API answers and Postgres is up (docs/operations/alarms.md). ${local.alarms_doc}"

  namespace   = "AWS/EC2"
  metric_name = "StatusCheckFailed_System"
  dimensions  = { InstanceId = aws_instance.brain[0].id }

  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = ["arn:aws:automate:ap-southeast-2:ec2:recover", aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# The OS stopped answering the hypervisor's probes: reboot it. Docker stops
# Postgres cleanly on the way down and the boot unit starts it again.
resource "aws_cloudwatch_metric_alarm" "brain_instance_status_failed" {
  count = local.brain_enabled ? 1 : 0

  alarm_name        = "logjam-brain-instance-status-failed"
  alarm_description = "The brain's instance status check failed for 10 minutes; it is being rebooted. First: wait for the OK email; if it comes back failing, open a Session Manager shell and read journalctl -b -u brain-boot and df -h /. ${local.alarms_doc}"

  namespace   = "AWS/EC2"
  metric_name = "StatusCheckFailed_Instance"
  dimensions  = { InstanceId = aws_instance.brain[0].id }

  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 10
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = ["arn:aws:automate:ap-southeast-2:ec2:reboot", aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Only in standard mode (not the default). At zero the CPU is throttled to its
# baseline, which would slow Postgres and the API together. The balance is
# published every 5 minutes: six low readings in a row is 30 minutes.
resource "aws_cloudwatch_metric_alarm" "brain_cpu_credits_low" {
  count = local.brain_enabled && var.brain_cpu_credits == "standard" ? 1 : 0

  alarm_name        = "logjam-brain-cpu-credits-low"
  alarm_description = "The brain's CPU credit balance has been under 30 for 30 minutes (standard credit mode); at zero it is throttled. First: find what is using the CPU, then switch to unlimited credits or a bigger instance type if the load is real. ${local.alarms_doc}"

  namespace   = "AWS/EC2"
  metric_name = "CPUCreditBalance"
  dimensions  = { InstanceId = aws_instance.brain[0].id }

  statistic           = "Average"
  period              = 300
  evaluation_periods  = 6
  comparison_operator = "LessThanThreshold"
  threshold           = 30
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Unlimited mode (the default) never throttles but bills any credit spent
# beyond what the instance earned: US$0.04 per vCPU-hour above the baseline,
# at worst about US$47 a month on a t4g.small (US$53 on a t4g.micro) with both
# cores pinned all month. This alarm is how any charge gets noticed.
resource "aws_cloudwatch_metric_alarm" "brain_cpu_surplus_credits_charged" {
  count = local.brain_enabled && var.brain_cpu_credits == "unlimited" ? 1 : 0

  alarm_name        = "logjam-brain-cpu-surplus-credits-charged"
  alarm_description = "The brain was charged for surplus CPU credits in the last hour (unlimited credit mode, the default). First: find what is using the CPU; the worst case is about US$47 a month on a t4g.small if both cores were pinned all month. ${local.alarms_doc}"

  namespace   = "AWS/EC2"
  metric_name = "CPUSurplusCreditsCharged"
  dimensions  = { InstanceId = aws_instance.brain[0].id }

  statistic           = "Maximum"
  period              = 3600
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}
