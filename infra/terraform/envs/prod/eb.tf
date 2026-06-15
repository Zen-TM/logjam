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
