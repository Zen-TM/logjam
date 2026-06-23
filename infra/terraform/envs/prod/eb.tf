# Elastic Beanstalk API. CI (deploy-api.yml) owns deploys: it pushes the image,
# bundles Dockerrun.aws.json + .ebextensions (DB_* env, DB_SECRET_ID), and
# creates a new application version every push. Terraform therefore does NOT
# manage option_settings (ignore_changes = [setting]) or app versions — it only
# anchors the application + environment shells so they're part of the graph.
# prevent_destroy guards the env whose CNAME the api CloudFront origin targets.

resource "aws_elastic_beanstalk_application" "main" {
  name = "logjam"
}

resource "aws_elastic_beanstalk_environment" "api" {
  name                   = "logjam-api-prod"
  application            = aws_elastic_beanstalk_application.main.name
  solution_stack_name    = "64bit Amazon Linux 2023 v4.11.0 running Docker"
  tier                   = "WebServer"
  wait_for_ready_timeout = "20m"

  lifecycle {
    prevent_destroy = true
    # Option settings are CI/EB-owned (.ebextensions + console). Pinning them
    # here would fight every deploy; ignore them wholesale. wait_for_ready_timeout
    # is a TF-only apply-wait knob that import never populates, so it also
    # perpetually diffs — ignore it too.
    ignore_changes = [setting, wait_for_ready_timeout]
  }
}

# Network-layer direct-origin guard. The EB environment is single-instance (no
# load balancer), so its CNAME resolves straight to the instance's public IP.
# By default the EB-managed instance SG allows :80 from 0.0.0.0/0, leaving the
# API origin reachable directly — bypassing the CloudFront edge WAF (rate
# limiting) and exposing plaintext :80 to anyone who knows the CNAME (it's in
# cloudfront.tf). This restricts :80 ingress to CloudFront's origin-facing IP
# ranges (AWS-managed prefix list), the network-layer half of the guard whose
# app-layer half is origin-verify (origin_verify.tf + api/src/index.ts):
#   - network rule drops all non-CloudFront packets at the NIC (no instance cost,
#     stops direct floods + plaintext probes, covers the origin-verify-exempt
#     /health + /ready paths);
#   - origin-verify's secret header covers the residual the prefix list can't —
#     OTHER customers' CloudFront distributions share the same prefix list.
# The SG is EB-managed (created by the environment's CloudFormation stack,
# referenced by literal id since TF doesn't own it). Managing just this rule
# here means an EB rebuild re-adding 0.0.0.0/0 surfaces as drift on `plan`.
resource "aws_vpc_security_group_ingress_rule" "eb_http_cloudfront_only" {
  security_group_id = "sg-016b93b75c584bd70"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = "pl-b8a742d1"
  description       = "CloudFront origin-facing only (WAF-bypass / direct-origin guard)"
}
