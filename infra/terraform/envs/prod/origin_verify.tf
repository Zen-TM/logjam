# CloudFront origin-verify (WAF-bypass guard). Closes the direct-to-origin hole:
# the brain's address is reachable on the public internet (its security group
# narrows port 80 to CloudFront's prefix list, which other customers share), so
# a client that finds it could hit the API while skipping the CloudFront edge
# WAF entirely. This
# wires a shared secret only CloudFront knows — the api distribution injects it
# as the X-Origin-Verify header on every origin fetch (cloudfront.tf), and the
# API rejects requests whose header doesn't match (api/src/index.ts).
#
# Secret-in-state note: unlike the DB/Resend secrets we deliberately keep OUT of
# state, this token is generated here and DOES live in Terraform state (the state
# bucket is private + encrypted), in random_password and in the CloudFront
# header, which is not write-only. A single managed random_password is the
# least-footgun source of truth — a hand-set tfvar would land in state too the
# moment it feeds the header, with extra coordination risk.
#
# The Secrets Manager version takes it write-only (secret_string_wo), so
# Terraform never reads the value back: refreshing the version lists its
# version ids instead of calling GetSecretValue, and no CI role needs that
# call. To rotate, replace random_password.origin_verify and bump
# secret_string_wo_version in the same change: a new value alone is never
# written to the secret, and CloudFront would send a header the API rejects.
# The API reads the secret at boot, so restart it after the apply. Guard:
# tests/guards.tftest.hcl.
#
# This is defense-in-depth on the origin, not a user-auth credential.

resource "random_password" "origin_verify" {
  length  = 48
  special = false # alphanumeric: header-safe, no HTTP header-quoting concerns
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name        = "logjam/origin-verify"
  description = "CloudFront origin-verify shared secret (X-Origin-Verify). Resolved by the API at boot; compared per request."
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id                = aws_secretsmanager_secret.origin_verify.id
  secret_string_wo         = random_password.origin_verify.result
  secret_string_wo_version = 1
}

output "origin_verify_secret_arn" {
  description = "Secrets Manager ARN of the CloudFront origin-verify token (value never exposed)."
  value       = aws_secretsmanager_secret.origin_verify.arn
}
