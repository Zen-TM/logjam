# The repository's own GitHub settings. Applied only by terraform-apply.yml,
# like envs/prod (docs/decisions/0025-github-settings-in-terraform.md).
#
# The token comes from GITHUB_TOKEN: a GitHub App installation token the
# workflow mints, read-only for plans and admin for applies. Both Apps need
# Contents: write, because GitHub hides the merge settings on
# github_repository.logjam from a token without it, and every plan would then
# show a change.
provider "github" {
  owner = "Zen-TM"
}

locals {
  repository = "logjam"

  # Zen-TM, the repository's admin and code owner (.github/CODEOWNERS).
  maintainer_user_id = 86338167
}
