# A contributor's console sign-in: read-only, MFA required, every change goes
# through Terraform. The user and group predate this file, so they are
# imported. The login profile (the password) is deliberately not managed:
# Terraform would have to hold or reset it, and the apply role may not touch
# login profiles (iam_apply.tf).
#
# The grant is the CI plan role's: ReadOnlyAccess plus the same privacy Deny
# (local.ci_readonly_privacy_deny, iam.tf), so the contributor reads no user
# data, secret values, logs or user directory either.
locals {
  contributor_user  = "collaborator-oliver"
  contributor_group = "logjam-developers"

  # One policy so the Deny and the MFA gate cannot be detached from each
  # other. Inline, not managed: the group inline limit is 5,120 characters,
  # and tests/guards.tftest.hcl fails before apply would if this outgrows it.
  contributor_policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      jsondecode(local.ci_readonly_privacy_deny).Statement,
      [
        # Without these the MFA gate below would lock him out of enrolling.
        # Listing is exempt so the console can show which device is enrolled
        # and the password policy it must satisfy.
        {
          Sid      = "AllowViewAccountInfo"
          Effect   = "Allow"
          Action   = ["iam:GetAccountPasswordPolicy", "iam:ListVirtualMFADevices"]
          Resource = "*"
        },
        # A first sign-in with a reset password forces a change before MFA
        # exists, so changing the password cannot wait for MFA.
        {
          Sid      = "AllowManageOwnPassword"
          Effect   = "Allow"
          Action   = ["iam:ChangePassword", "iam:GetUser"]
          Resource = "arn:aws:iam::620853681701:user/$${aws:username}"
        },
        # Enrolling and resyncing a device is the way out of the gate. Only his
        # own device and user: never another user's.
        {
          Sid    = "AllowManageOwnMfa"
          Effect = "Allow"
          Action = [
            "iam:CreateVirtualMFADevice",
            "iam:DeleteVirtualMFADevice",
            "iam:EnableMFADevice",
            "iam:DeactivateMFADevice",
            "iam:ListMFADevices",
            "iam:ResyncMFADevice",
          ]
          Resource = [
            "arn:aws:iam::620853681701:mfa/$${aws:username}",
            "arn:aws:iam::620853681701:user/$${aws:username}",
          ]
        },
        # BoolIfExists, not Bool: a request with no MFA key at all (long-lived
        # credentials) must be denied too. Deactivate and Delete are not
        # exempt, so removing a device itself needs MFA. sts:GetSessionToken is
        # how the console session is upgraded once a device exists.
        {
          Sid    = "DenyAllWithoutMfa"
          Effect = "Deny"
          NotAction = [
            "iam:ChangePassword",
            "iam:CreateVirtualMFADevice",
            "iam:EnableMFADevice",
            "iam:GetAccountPasswordPolicy",
            "iam:GetUser",
            "iam:ListMFADevices",
            "iam:ListVirtualMFADevices",
            "iam:ResyncMFADevice",
            "sts:GetSessionToken",
          ]
          Resource  = "*"
          Condition = { BoolIfExists = { "aws:MultiFactorAuthPresent" = "false" } }
        },
      ],
    )
  })
}

resource "aws_iam_user" "contributor" {
  name = local.contributor_user
}

resource "aws_iam_group" "contributor" {
  name = local.contributor_group
}

# The non-exclusive form on purpose: it adds this one group and leaves any
# other group of his alone.
resource "aws_iam_user_group_membership" "contributor" {
  user   = aws_iam_user.contributor.name
  groups = [aws_iam_group.contributor.name]
}

resource "aws_iam_group_policy" "contributor" {
  name   = "logjam-contributor-readonly"
  group  = aws_iam_group.contributor.name
  policy = local.contributor_policy
}

# Exclusive, so a policy attached by hand, including the one that was on this
# group before it was imported, is detached by the next apply rather than
# left to widen the grant.
resource "aws_iam_group_policy_attachments_exclusive" "contributor" {
  group_name  = aws_iam_group.contributor.name
  policy_arns = ["arn:aws:iam::aws:policy/ReadOnlyAccess"]
}

resource "aws_iam_group_policies_exclusive" "contributor" {
  group_name   = aws_iam_group.contributor.name
  policy_names = [aws_iam_group_policy.contributor.name]
}

import {
  to = aws_iam_user.contributor
  id = "collaborator-oliver"
}

import {
  to = aws_iam_group.contributor
  id = "logjam-developers"
}

import {
  to = aws_iam_user_group_membership.contributor
  id = "collaborator-oliver/logjam-developers"
}
