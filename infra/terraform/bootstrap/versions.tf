terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Local state on purpose: this root only creates the S3 bucket that every
  # OTHER root uses as its backend, so it cannot itself live in that backend
  # (chicken-and-egg). Its state file stays local + gitignored; this root is
  # applied once and rarely touched again.
}
