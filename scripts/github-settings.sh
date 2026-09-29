#!/usr/bin/env bash
# GitHub repository settings as code: the `prod` deployment Environment and the
# ruleset protecting main. Repo settings clicked in the UI drift silently; this
# file is the one declaration, and later changes extend it.
#
#   scripts/github-settings.sh           print what would be sent (default)
#   scripts/github-settings.sh --apply   write it (needs repo admin via `gh`)
#
# What it enforces, and why:
#   - Repository variables the workflows read: PROD_API_URL and PROD_WEB_URL,
#     the public URLs smoke.yml probes after a deploy or rollback, and that
#     rollback-compat.yml asks for the live release.
#   - `prod` Environment, deployable from main only. The AWS deploy role trusts
#     only jobs in this Environment (infra/terraform/envs/prod/iam.tf), so a
#     workflow pushed to any other branch cannot assume it.
#   - main ruleset: no deletion or force-push; the existing required checks; a PR
#     needs a CODEOWNERS approval (.github/CODEOWNERS), and a new push dismisses
#     an earlier approval. Only a bypass actor may update main at all ("update"
#     rule), so only repository admins (the maintainer) can merge, and they
#     always can: an approved PR does not let a collaborator merge it.
#   - plan-prod (terraform-plan.yml) is a required check, and a PR must be up to
#     date with main to merge: merge = apply (terraform-apply.yml), which refuses
#     unless its plan matches the PR's, and that only holds when the PR was
#     planned against the main it merges into. The apply role, like the deploy
#     role, trusts only the `prod` Environment (envs/prod/iam_apply.tf).
#   - Logjam GPS releases: a mobile-v* tag push releases (deploy-mobile.yml),
#     and the workflow also accepts a tag on a release/mobile-v* branch. Only
#     repository admins may create, move or delete either (rulesets
#     mobile-release-tags and mobile-release-branches), and the
#     `mobile-release` Environment, which holds EXPO_TOKEN, is deployable from
#     mobile-v* tags only. The secret itself is set by hand.
#   - The classic branch protection and the disabled "No Commits to main"
#     ruleset are removed once the ruleset exists, leaving one source of truth.
#   - Issue labels the issue forms (.github/ISSUE_TEMPLATE/) and
#     CONTRIBUTING.md use; they must exist for the forms to apply them.
set -euo pipefail

REPO="Zen-TM/logjam"
RULESET_NAME="main"
APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

REQUIRED_CHECKS='[{"context":"shared"},{"context":"api"},{"context":"frontend"},{"context":"topo"},{"context":"format"},{"context":"actionlint"},{"context":"plan-prod"}]'

# name|color|description
LABELS=(
  "bug|d73a4a|Something doesn't work as it should"
  "proposal|a2eeef|A feature or change to agree before writing code"
  "triage|fbca04|Not yet looked at by the maintainer"
  "accepted|0e8a16|Approach agreed: a pull request can follow"
)

# name=value; public URLs, not secrets.
VARIABLES=(
  "PROD_API_URL=https://api.logjamnsw.com"
  "PROD_WEB_URL=https://logjamnsw.com"
)

ENVIRONMENT_BODY='{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'

# Environment=the one ref pattern allowed to deploy from it:its type.
ENVIRONMENTS=(
  "prod=main:branch"
  "mobile-release=mobile-v*:tag"
)

RELEASE_TAGS_BODY=$(
  cat <<'JSON'
{
  "name": "mobile-release-tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/mobile-v*"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }]
}
JSON
)

RELEASE_BRANCHES_BODY=$(
  cat <<'JSON'
{
  "name": "mobile-release-branches",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/release/mobile-v*"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }]
}
JSON
)

RULESET_BODY=$(cat <<JSON
{
  "name": "$RULESET_NAME",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "update", "parameters": { "update_allows_fetch_and_merge": false } },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": $REQUIRED_CHECKS
      }
    }
  ]
}
JSON
)

run() {
  # run METHOD PATH [BODY]
  local method=$1 path=$2 body=${3:-}
  if ! $APPLY; then
    echo "would: gh api -X $method $path"
    [ -n "$body" ] && echo "$body"
    return 0
  fi
  if [ -n "$body" ]; then
    gh api -X "$method" "$path" --input - <<<"$body" >/dev/null
  else
    gh api -X "$method" "$path" >/dev/null
  fi
  echo "done: $method $path"
}

# 1. Environments, each deployable from one ref pattern only
for entry in "${ENVIRONMENTS[@]}"; do
  env=${entry%%=*} policy=${entry#*=}
  pattern=${policy%:*} type=${policy##*:}
  run PUT "repos/$REPO/environments/$env" "$ENVIRONMENT_BODY"
  # (a missing Environment 404s here; gh prints the error body to stdout, so
  # only trust the output when the call succeeded)
  if policies=$(gh api "repos/$REPO/environments/$env/deployment-branch-policies" \
      --jq "[.branch_policies[] | select(.name == \"$pattern\" and .type == \"$type\")] | length" 2>/dev/null); then
    has_policy=$policies
  else
    has_policy=0
  fi
  if [ "$has_policy" = "0" ]; then
    run POST "repos/$REPO/environments/$env/deployment-branch-policies" \
      "$(jq -nc --arg name "$pattern" --arg type "$type" '{name: $name, type: $type}')"
  fi
done

# 2. rulesets (create or replace by name)
upsert_ruleset() {
  local name=$1 body=$2 id
  id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$name\") | .id")
  if [ -n "$id" ]; then
    run PUT "repos/$REPO/rulesets/$id" "$body"
  else
    run POST "repos/$REPO/rulesets" "$body"
  fi
}
upsert_ruleset "$RULESET_NAME" "$RULESET_BODY"
upsert_ruleset mobile-release-tags "$RELEASE_TAGS_BODY"
upsert_ruleset mobile-release-branches "$RELEASE_BRANCHES_BODY"

# issue labels (create or update by name)
for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color description <<<"$entry"
  body=$(jq -nc --arg name "$name" --arg color "$color" --arg description "$description" \
    '{name: $name, color: $color, description: $description}')
  if gh api "repos/$REPO/labels/$name" >/dev/null 2>&1; then
    run PATCH "repos/$REPO/labels/$name" "$body"
  else
    run POST "repos/$REPO/labels" "$body"
  fi
done

# 3. repository variables (create or update by name)
for pair in "${VARIABLES[@]}"; do
  name=${pair%%=*} value=${pair#*=}
  body=$(jq -nc --arg name "$name" --arg value "$value" '{name: $name, value: $value}')
  if gh api "repos/$REPO/actions/variables/$name" >/dev/null 2>&1; then
    run PATCH "repos/$REPO/actions/variables/$name" "$body"
  else
    run POST "repos/$REPO/actions/variables" "$body"
  fi
done

# 4. retire the older mechanisms, only once the ruleset exists
if $APPLY; then
  gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id" | grep -q . \
    || { echo "ruleset $RULESET_NAME missing after apply; leaving classic protection in place" >&2; exit 1; }
fi
old_id=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name == "No Commits to main") | .id')
[ -n "$old_id" ] && run DELETE "repos/$REPO/rulesets/$old_id"
if gh api "repos/$REPO/branches/main/protection" >/dev/null 2>&1; then
  run DELETE "repos/$REPO/branches/main/protection"
fi
