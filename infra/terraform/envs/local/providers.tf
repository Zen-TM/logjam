# MiniStack-targeted AWS provider. The skip_* flags stop the provider trying
# to reach real AWS metadata/STS, and the dummy "test" creds plus the :4566
# endpoint mean this provider physically CANNOT touch real AWS — it is walled
# off to the local MiniStack container. s3_use_path_style mirrors the
# forcePathStyle:true in api/src/services/awsClients.ts so presigned-URL host
# shapes match between Terraform-created buckets and the app.
#
# ECS endpoint registers the cluster + worker task defs (see ecs.tf) into
# MiniStack so the API's RunTask launches them locally. ses/cognito/secretsmanager
# are pointed here too so any provisioning against them stays walled off.
provider "aws" {
  region                      = "ap-southeast-2"
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  s3_use_path_style           = true

  endpoints {
    s3             = "http://localhost:4566"
    ecs            = "http://localhost:4566"
    ses            = "http://localhost:4566"
    cognitoidp     = "http://localhost:4566"
    secretsmanager = "http://localhost:4566"
  }
}

provider "local" {}
