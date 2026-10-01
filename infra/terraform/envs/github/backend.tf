terraform {
  backend "s3" {
    bucket       = "logjam-tfstate-620853681701"
    key          = "github/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
