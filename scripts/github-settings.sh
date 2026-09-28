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
#   - The classic branch protection and the disabled "No Commits to main"
#     ruleset are removed once the ruleset exists, leaving one source of truth.
set -euo pipefail

REPO="Zen-TM/logjam"
RULESET_NAME="main"
APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

REQUIRED_CHECKS='[{"context":"shared"},{"context":"api"},{"context":"frontend"},{"context":"topo"},{"context":"format"},{"context":"actionlint"},{"context":"plan-prod"}]'

# name=value; public URLs, not secrets.
VARIABLES=(
  "PROD_API_URL=https://api.logjamnsw.com"
  "PROD_WEB_URL=https://logjamnsw.com"
)

ENVIRONMENT_BODY='{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'

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

# 1. prod Environment, main only
run PUT "repos/$REPO/environments/prod" "$ENVIRONMENT_BODY"
# (a missing Environment 404s here; gh prints the error body to stdout, so
# only trust the output when the call succeeded)
if policies=$(gh api "repos/$REPO/environments/prod/deployment-branch-policies" \
    --jq '[.branch_policies[] | select(.name == "main")] | length' 2>/dev/null); then
  has_main_policy=$policies
else
  has_main_policy=0
fi
if [ "$has_main_policy" = "0" ]; then
  run POST "repos/$REPO/environments/prod/deployment-branch-policies" '{"name":"main","type":"branch"}'
fi

# 2. main ruleset (create or replace by name)
ruleset_id=$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id")
if [ -n "$ruleset_id" ]; then
  run PUT "repos/$REPO/rulesets/$ruleset_id" "$RULESET_BODY"
else
  run POST "repos/$REPO/rulesets" "$RULESET_BODY"
fi

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
