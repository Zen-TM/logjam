# GitHub Actions OIDC identity provider — trusted by logjam-github-actions-role
# (see iam.tf) so CI can assume that role via web identity. url carries the
# https:// scheme the provider's schema requires (AWS stores it without).
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["2b18947a6a9fc7764fd8b5fb18a863b0c6dac24f"]
}
