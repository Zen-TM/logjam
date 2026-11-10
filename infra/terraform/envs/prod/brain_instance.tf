# The brain: ONE plain EC2 instance running Postgres and the API under Docker
# Compose, its data on a separate volume, and an Elastic IP whose DNS name every
# client and the database certificate use. The host's behaviour is
# infra/brain/host/; this file only makes the machine and tells it what it is.
#
# With an empty var.brain_pg_image_tag nothing here exists (no instance, volume
# or address), so merging this costs nothing. Guard: tests/guards.tftest.hcl
# (brain_is_absent_by_default).
locals {
  brain_enabled = var.brain_pg_image_tag != ""

  # Memory settings by instance size: 25% of RAM for shared_buffers and 50% for
  # effective_cache_size. A type that is not here fails the plan (the
  # brain_instance_type variable's validation).
  brain_pg_memory = {
    "t4g.small"  = { shared_buffers = "512MB", effective_cache_size = "1GB" }
    "t4g.medium" = { shared_buffers = "1GB", effective_cache_size = "2GB" }
    "t4g.large"  = { shared_buffers = "2GB", effective_cache_size = "4GB" }
  }

  brain_current_az = var.brain_data_volumes[var.brain_data_volume_current].az
  brain_subnet_by_az = {
    (data.aws_subnet.worker_a.availability_zone) = data.aws_subnet.worker_a.id
    (data.aws_subnet.worker_b.availability_zone) = data.aws_subnet.worker_b.id
  }
  brain_registry = split("/", aws_ecr_repository.brain_postgres.repository_url)[0]

  # What host/lib.sh reads, key for key (the table under "Interface between
  # Terraform and the host" in the brain's design). Plain KEY=value, no
  # secrets: that file has no quoting. Guard: brain_env_is_plain_key_value_the_host_files_read.
  brain_env = local.brain_enabled ? {
    AWS_REGION             = "ap-southeast-2"
    BRAIN_DATA_DEVICE      = "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${replace(aws_ebs_volume.brain_data[var.brain_data_volume_current].id, "-", "")}"
    BRAIN_PG_IMAGE         = "${aws_ecr_repository.brain_postgres.repository_url}:${var.brain_pg_image_tag}"
    BRAIN_API_REPO         = aws_ecr_repository.api.repository_url
    BRAIN_BACKUP_BUCKET    = aws_s3_bucket.brain_backups.bucket
    BRAIN_SIGNALS_BUCKET   = aws_s3_bucket.brain_signals.bucket
    BRAIN_TLS_SANS         = "${aws_eip.brain[0].public_dns},postgres,localhost"
    BRAIN_PG_FLAGS         = "-c shared_buffers=${local.brain_pg_memory[var.brain_instance_type].shared_buffers} -c effective_cache_size=${local.brain_pg_memory[var.brain_instance_type].effective_cache_size}"
    BRAIN_APP_DB_SECRET_ID = aws_secretsmanager_secret.app_db.name
    BRAIN_LOG_GROUP_API    = aws_cloudwatch_log_group.brain_api.name
    BRAIN_LOG_GROUP_PG     = aws_cloudwatch_log_group.brain_postgres.name
  } : {}

  # The host files travel inline in the user data, as plain text (EC2 caps user
  # data at 16,384 bytes; the whole script is gzipped below, and a zip of the
  # same files would not fit). Terraform cannot keep them in S3: under the CI
  # privacy Deny it could not read them back. Scripts are executable, the rest
  # are not. Guards: brain_user_data_stays_within_the_ec2_limit and
  # brain_host_files_embed_cleanly_and_hold_no_secret.
  brain_dir           = "${path.module}/../../../brain"
  brain_heredoc_end   = "BRAIN_HOST_FILE_EOF"
  brain_host_file_set = sort([for f in fileset(local.brain_dir, "**") : f if !startswith(f, "postgres/") && !startswith(f, "tests/") && f != "api.env"])
  brain_host_files = join("\n", [
    for f in local.brain_host_file_set :
    "install -D -m ${endswith(f, ".sh") ? "0755" : "0644"} /dev/stdin /opt/brain/${f} <<'${local.brain_heredoc_end}'\n${trimsuffix(file("${local.brain_dir}/${f}"), "\n")}\n${local.brain_heredoc_end}"
  ])

  # Pulls from the account's registry (the Postgres image now, the API image
  # when a release names it) authenticate through amazon-ecr-credential-helper
  # with the instance role.
  brain_docker_config = jsonencode({ credHelpers = { (local.brain_registry) = "ecr-login" } })

  brain_user_data = templatefile("${path.module}/brain_user_data.sh.tftpl", {
    docker_config = local.brain_docker_config
    pg_image      = local.brain_enabled ? local.brain_env["BRAIN_PG_IMAGE"] : ""
    host_files    = local.brain_host_files
    brain_env     = join("\n", [for k, v in local.brain_env : "${k}=${v}"])
  })
}

# The newest Amazon Linux 2023 arm64 AMI, looked up here and not through the
# SSM parameter: CI may not call ssm:GetParameter. The instance ignores later
# changes to it, so a new AMI never replaces the database host by surprise.
data "aws_ami" "brain" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-kernel-6.12-arm64"]
  }
  filter {
    name   = "architecture"
    values = ["arm64"]
  }
}

# Encrypted with the account's default EBS key. Never destroyed or replaced by
# Terraform: it holds the only copy of the database between backups. Guard:
# brain_data_volume_and_address_keep_prevent_destroy.
resource "aws_ebs_volume" "brain_data" {
  for_each = local.brain_enabled ? var.brain_data_volumes : {}

  availability_zone = each.value.az
  size              = each.value.size_gb
  type              = "gp3"
  encrypted         = true

  tags = {
    Name         = "logjam-brain-data-${each.key}"
    brain-volume = each.key
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_instance" "brain" {
  count = local.brain_enabled ? 1 : 0

  ami                    = data.aws_ami.brain.id
  instance_type          = var.brain_instance_type
  subnet_id              = local.brain_subnet_by_az[local.brain_current_az]
  vpc_security_group_ids = [aws_security_group.brain.id]
  iam_instance_profile   = aws_iam_instance_profile.brain.name
  # No key pair: the host is reached through Session Manager. Guard:
  # brain_instance_is_locked_down.

  # The first boot needs egress before the Elastic IP attaches (the subnets do
  # not hand out public addresses by themselves).
  associate_public_ip_address = true
  disable_api_termination     = true

  # Any change to a host file or to brain.env changes this, and replaces the
  # instance: a few minutes of downtime, data volume kept. Intended: the root
  # disk is disposable and cloud-init runs user data once. Guard:
  # brain_instance_is_locked_down.
  user_data_base64            = base64gzip(local.brain_user_data)
  user_data_replace_on_change = true

  # Hop limit 2: containers use the instance role through the metadata service,
  # as the API does on Elastic Beanstalk today. Tags are readable there because
  # the host reads its two switches from them (infra/brain/host/lib.sh).
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
    instance_metadata_tags      = "enabled"
  }

  credit_specification {
    cpu_credits = var.brain_cpu_credits
  }

  maintenance_options {
    auto_recovery = "default"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.brain_root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  # The switches are tags the host reads at boot and on every release tick, so
  # flipping either is an in-place update and never replaces the instance (no
  # tag value reaches the user data). Guard: brain_switches_are_in_place_tags.
  tags = {
    Name            = "logjam-brain"
    brain-serving   = var.brain_serving ? "on" : "off"
    brain-bootstrap = var.brain_bootstrap ? "1" : "0"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}

# Only the current volume is attached. stop_instance_before_detaching: when the
# instance is replaced the OS shuts down first, so Docker stops Postgres cleanly
# before the volume lets go. Guard: brain_only_the_current_volume_is_attached_in_its_zone.
resource "aws_volume_attachment" "brain_data" {
  count = local.brain_enabled ? 1 : 0

  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.brain_data[var.brain_data_volume_current].id
  instance_id                    = aws_instance.brain[0].id
  stop_instance_before_detaching = true
}

# Its DNS name is in the database certificate and in every client's config, so
# it is never given up. Guard: brain_data_volume_and_address_keep_prevent_destroy.
resource "aws_eip" "brain" {
  count = local.brain_enabled ? 1 : 0

  domain = "vpc"
  tags   = { Name = "logjam-brain" }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_eip_association" "brain" {
  count = local.brain_enabled ? 1 : 0

  allocation_id = aws_eip.brain[0].id
  instance_id   = aws_instance.brain[0].id
}

output "brain_public_dns" {
  description = "The brain's stable name: its private IP inside the VPC, its public IP outside. Empty until the instance exists."
  value       = local.brain_enabled ? aws_eip.brain[0].public_dns : ""
}

output "brain_host_env" {
  description = "What /etc/brain/brain.env holds (no secrets). Empty until the instance exists."
  value       = local.brain_env
}

# A change here is a change to the user data, and replaces the instance: the
# signed plan shows it as an output change. Also how the guard proves the
# switches stay out of it.
output "brain_user_data_sha256" {
  description = "Hash of the brain's rendered user data; a new value means the instance is replaced. Empty until the instance exists."
  value       = local.brain_enabled ? sha256(local.brain_user_data) : ""
}
