terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }

  # No backend block: this root only ever talks to MiniStack on the dev
  # machine. Its state is disposable (wiped alongside the MiniStack volume on
  # `make reset`) and stays a local, gitignored file. It must NEVER use the
  # prod S3 backend, so `infra/scripts/check-terraform-backends.py` — run in CI
  # — fails if this root (or any other non-prod one) grows one, and if prod or
  # github ever loses theirs.
}
