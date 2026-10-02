# CloudFront origin-verify (WAF-bypass guard). Closes the direct-to-EB hole: the
# EB environment CNAME is reachable on the public internet, so a client that
# knows it can hit the API while skipping the CloudFront edge WAF entirely. This
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
#
# ROLLOUT (no lockout — full sequence in api/.ebextensions/origin-verify.config):
#   1. Apply this + the cloudfront.tf custom_header. App stays PERMISSIVE
#      (ORIGIN_VERIFY_ENFORCE=false) — it only logs `origin_verify_mismatch`.
#   2. Redeploy the API so it resolves ORIGIN_VERIFY_SECRET_ID and starts
#      comparing. Watch the mismatch log fall to ~zero (all live traffic now
#      transits CloudFront, which sends the header).
#   3. Flip ORIGIN_VERIFY_ENFORCE=true and redeploy → 403 for direct-to-EB hits.

resource "random_password" "origin_verify" {
  length  = 48
  special = false # alphanumeric: header-safe, no HTTP header-quoting concerns
}

resource "aws_secretsmanager_secret" "origin_verify" {
  name        = "logjam/origin-verify"
  description = "CloudFront origin-verify shared secret (X-Origin-Verify). Resolved by the EB API at boot; compared per request."
}

resource "aws_secretsmanager_secret_version" "origin_verify" {
  secret_id                = aws_secretsmanager_secret.origin_verify.id
  secret_string_wo         = random_password.origin_verify.result
  secret_string_wo_version = 1
}

# EB instance role resolves the token at boot (mirrors the app-db grant in
# db_app_role.tf). MUST be applied before .ebextensions sets
# ORIGIN_VERIFY_SECRET_ID, or boot's resolver fails on GetSecretValue.
resource "aws_iam_policy" "origin_verify_access" {
  name = "OriginVerifySecretAccess"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = aws_secretsmanager_secret.origin_verify.arn
    }]
  })
}

resource "aws_iam_role_policy_attachment" "eb_instance_origin_verify" {
  role       = "logjam-eb-role"
  policy_arn = aws_iam_policy.origin_verify_access.arn
}

output "origin_verify_secret_arn" {
  description = "Secrets Manager ARN of the CloudFront origin-verify token (value never exposed)."
  value       = aws_secretsmanager_secret.origin_verify.arn
}
