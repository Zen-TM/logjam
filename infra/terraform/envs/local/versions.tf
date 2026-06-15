terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }

  # No backend block: this root only ever talks to LocalStack on the dev
  # machine. Its state is disposable (wiped alongside the LocalStack volume on
  # `make reset`) and stays a local, gitignored file. It must NEVER use the
  # prod S3 backend.
}
