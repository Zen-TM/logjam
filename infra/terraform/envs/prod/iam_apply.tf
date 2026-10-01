# Terraform apply from GitHub Actions (terraform-apply.yml: merge = apply).
#
# It needs near-admin to manage this root, so what bounds it is the permission
# boundary below, not its grant. An explicit Deny in a boundary beats every
# Allow, including AdministratorAccess.
#
# Bootstrap: the role cannot create itself. Its first version is applied once
# by the maintainer from their own machine. After that, a change to anything in
# this file is theirs to apply the same way: the boundary denies the role
# editing itself, so terraform-apply.yml refuses such a plan up front rather
# than fail half-way (infra/scripts/plan-summary.mjs matches `github_actions_apply`
# in the address: keep that in every resource name here).
#
# Trust: jobs in the `prod` GitHub Environment, which only main may deploy to
# (infra/terraform/envs/github/environments.tf). The deploy role trusts the
# same subject; a separate Environment would not separate them, since any
# workflow on main can name any Environment.
locals {
  github_actions_apply_role     = "logjam-github-actions-apply-role"
  github_actions_apply_boundary = "logjam-github-actions-apply-boundary"
}

resource "aws_iam_role" "github_actions_apply" {
  name                 = local.github_actions_apply_role
  description          = "terraform apply for envs/prod from GitHub Actions (main, prod Environment)."
  permissions_boundary = aws_iam_policy.github_actions_apply_boundary.arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.github_oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:Zen-TM/logjam:environment:prod"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_apply_admin" {
  role       = aws_iam_role.github_actions_apply.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ARNs are spelled out, not referenced: the role already references this
# policy, and a reference back would be a cycle.
resource "aws_iam_policy" "github_actions_apply_boundary" {
  name        = local.github_actions_apply_boundary
  description = "Permission boundary for the terraform apply role: no user data, no DB, no secrets, no self-edit."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [
        { Sid = "AllowWithinBoundary", Effect = "Allow", Action = "*", Resource = "*" },
        # Terraform never connects to the database; IAM DB auth would bypass
        # the app role's and the operator's audited paths (db_app_role.tf).
        { Sid = "DenyDbConnect", Effect = "Deny", Action = "rds-db:connect", Resource = "*" },
        {
          Sid    = "DenySelfEdit"
          Effect = "Deny"
          Action = [
            "iam:AttachRolePolicy",
            "iam:DetachRolePolicy",
            "iam:PutRolePolicy",
            "iam:DeleteRolePolicy",
            "iam:UpdateAssumeRolePolicy",
            "iam:PutRolePermissionsBoundary",
            "iam:DeleteRolePermissionsBoundary",
            "iam:UpdateRole",
            "iam:DeleteRole",
          ]
          Resource = "arn:aws:iam::620853681701:role/${local.github_actions_apply_role}"
        },
        {
          Sid    = "DenyBoundaryEdit"
          Effect = "Deny"
          Action = [
            "iam:CreatePolicyVersion",
            "iam:DeletePolicyVersion",
            "iam:SetDefaultPolicyVersion",
            "iam:DeletePolicy",
          ]
          Resource = "arn:aws:iam::620853681701:policy/${local.github_actions_apply_boundary}"
        },
        # Routes out of the boundary: becoming another role, or minting
        # long-lived credentials to use outside it. This root manages no IAM
        # users and assumes no roles.
        {
          Sid      = "DenyEscapingTheBoundary"
          Effect   = "Deny"
          Action   = ["sts:AssumeRole", "iam:CreateAccessKey", "iam:CreateLoginProfile", "iam:UpdateLoginProfile"]
          Resource = "*"
        },
      ],
      # The CI privacy Deny (iam.tf): user-data and audit objects, secret
      # values except origin_verify (the plan refreshes its version), the
      # Cognito CMK, DB log events. Its one Allow is for the read-only roles.
      [for s in jsondecode(local.ci_readonly_privacy_deny).Statement : s if s.Effect == "Deny"],
    )
  })
}
