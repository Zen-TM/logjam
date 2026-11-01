# Cognito user pool + app client. The pool ID and client ID are baked into the
# frontend build (VITE_COGNITO_*), the JWT issuer, and the API's aud check
# (api/src/middleware/auth.ts) — replacing either would invalidate every token and lock
# users out. prevent_destroy guards that; ignore_changes on schema stops a
# subtle attribute drift from forcing pool replacement. The pool already
# carries deletion_protection = ACTIVE server-side too.
#
# Logjam Web and Logjam GPS sign in through Managed Login (the user pool domain
# and branding below) with OIDC code + PKCE (#437). Logjam Web's deployed build
# still signs in with Amplify's SRP flow until its PR lands, so
# explicit_auth_flows keeps ALLOW_USER_SRP_AUTH until then.

resource "aws_cognito_user_pool" "main" {
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OFF"
  name                     = "logjam-user-pool"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 2
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  # email_configuration is bypassed for the flows CustomEmailSender handles —
  # Cognito invokes the Lambda (lambda_config below) instead of sending mail
  # itself. Left as COGNITO_DEFAULT as the inert fallback.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Route all verification/code emails through Resend (see lambda_cognito_email.tf)
  # so they pass DKIM/DMARC on notifications.logjamnsw.com and reach the inbox.
  # kms_key_id is the CMK Cognito uses to encrypt the code before invoking the
  # Lambda, which decrypts and sends.
  lambda_config {
    kms_key_id = aws_kms_key.cognito_email.arn
    custom_email_sender {
      lambda_arn     = aws_lambda_function.cognito_email_sender.arn
      lambda_version = "V1_0"
    }
  }

  password_policy {
    minimum_length                   = 8
    password_history_size            = 0
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "email"
    required                 = true
    string_attribute_constraints {
      max_length = "2048"
      min_length = "0"
    }
  }

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "name"
    required                 = true
    string_attribute_constraints {
      max_length = "2048"
      min_length = "0"
    }
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

  username_configuration {
    case_sensitive = false
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [schema]
  }
}

# 10 years: Logjam GPS must never sign a user out mid-trip, and a trip with no
# signal must not cost access to local data. A session ends by "Sign out
# everywhere" (GlobalSignOut), an explicit sign-out (enable_token_revocation)
# or an admin's AdminUserGlobalSignOut; a password change does not end one.
resource "aws_cognito_user_pool_client" "main" {
  access_token_validity                = 60
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  # profile: the code flow's ID token carries no profile claims without it.
  # aws.cognito.signin.user.admin: what change-email and GlobalSignOut call
  # Cognito with. Guard: guards.tftest.hcl (cognito_client_scopes_and_api_grant).
  allowed_oauth_scopes  = ["aws.cognito.signin.user.admin", "email", "openid", "phone", "profile"]
  auth_session_validity = 3
  # Logjam Web redirects to location.origin + "/" and the site answers on both
  # hosts; logjam://auth is Logjam GPS. The no-slash URL is what old builds use.
  callback_urls                                 = ["https://logjamnsw.com", "https://logjamnsw.com/", "https://www.logjamnsw.com/", "logjam://auth"]
  enable_propagate_additional_user_context_data = false
  enable_token_revocation                       = true
  explicit_auth_flows                           = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH", "ALLOW_USER_SRP_AUTH"]
  id_token_validity                             = 60
  logout_urls                                   = ["https://logjamnsw.com", "https://logjamnsw.com/", "https://www.logjamnsw.com/", "logjam://auth"]
  name                                          = "logjam"
  prevent_user_existence_errors                 = "ENABLED"
  read_attributes                               = []
  refresh_token_validity                        = 3650
  supported_identity_providers                  = ["COGNITO"]
  user_pool_id                                  = aws_cognito_user_pool.main.id
  write_attributes                              = []

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Managed Login's hosted pages live on this domain. A prefix domain, not a
# custom one: that needs an ACM certificate and DNS outside Terraform. The CSP
# already allows https://*.auth.ap-southeast-2.amazoncognito.com. Never
# destroyed live: it is the issuer of every sign-in. A pool holds one domain,
# and it replaced the default prefix the pool was created with, which no client
# used.
resource "aws_cognito_user_pool_domain" "main" {
  domain                = "logjamnsw"
  managed_login_version = 2
  user_pool_id          = aws_cognito_user_pool.main.id

  lifecycle {
    prevent_destroy = true
  }
}

# Logjam's look on the hosted pages: the Sandstone scheme (the default in
# shared/src/themeSchemes.ts) and the email logo lockup. Colours are
# RRGGBBAA hex without "#". Only the page, form and primary button are set;
# the rest keeps Cognito's dark-mode defaults. It references the client and
# the pool, so changing it never replaces either.
resource "aws_cognito_managed_login_branding" "main" {
  client_id    = aws_cognito_user_pool_client.main.id
  user_pool_id = aws_cognito_user_pool.main.id

  settings = jsonencode({
    categories = {
      global = { colorSchemeMode = "DARK" }
    }
    componentClasses = {
      input = {
        darkMode = {
          defaults = { backgroundColor = "1E1B18ff", borderColor = "6B5F4Bff" }
        }
      }
      link = {
        darkMode = {
          defaults = { textColor = "DEB188ff" }
          hover    = { textColor = "DEB188ff" }
        }
      }
    }
    components = {
      pageBackground = {
        image    = { enabled = false }
        darkMode = { color = "1E1B18ff" }
      }
      # The form matches the logo file's own background.
      form = {
        logo = {
          enabled       = true
          location      = "CENTER"
          position      = "TOP"
          formInclusion = "IN"
        }
        darkMode = {
          backgroundColor = "4E4944ff"
          borderColor     = "6B5F4Bff"
        }
      }
      primaryButton = {
        darkMode = {
          defaults = { backgroundColor = "DEB188ff", textColor = "1E1B18ff" }
        }
      }
    }
  })

  # A copy, not frontend/public's file: a change outside envs/prod would skip the
  # plan and apply (ADR 0024) and surface as drift.
  asset {
    bytes      = filebase64("${path.module}/assets/email-logo-lockup.png")
    category   = "FORM_LOGO"
    color_mode = "DYNAMIC"
    extension  = "PNG"
  }

  depends_on = [aws_cognito_user_pool_domain.main]
}
