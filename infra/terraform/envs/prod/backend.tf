terraform {
  backend "s3" {
    bucket       = "logjam-tfstate-620853681701"
    key          = "prod/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true # native S3 state locking — no DynamoDB table needed
  }
}
