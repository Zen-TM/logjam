provider "aws" {
  region = "ap-southeast-2"

  # Hard guard: refuse to run against any account but Logjam prod. Every
  # apply in this root touches real, live infrastructure.
  allowed_account_ids = ["620853681701"]
}

# CloudFront-scoped WAF web ACLs are global resources that live in us-east-1.
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = ["620853681701"]
}
