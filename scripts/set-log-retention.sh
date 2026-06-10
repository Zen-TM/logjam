#!/bin/bash
# Apply the 90-day CloudWatch log retention privacy.html commits to (PRIV-007).
#
# Verified 2026-06-11 via `aws logs describe-log-groups --profile logjam`:
#   - /aws/elasticbeanstalk/logjam-api-prod/* groups: 7 days (already < 90, untouched)
#   - /aws/ecs/containerinsights/logjam-cluster/performance: 1 day (untouched)
#   - /ecs/logjam-topo-worker:        retention NULL (never expire)  <- fixed here
#   - /ecs/logjam-topo-export-worker: retention NULL (never expire)  <- fixed here
#
# Idempotent: put-retention-policy overwrites any existing policy with the same
# value. PROD-TARGETED — run only with explicit operator intent.
# Rollback: aws logs delete-retention-policy --log-group-name <group> ...
set -euo pipefail

PROFILE="logjam"
REGION="ap-southeast-2"
RETENTION_DAYS=90

LOG_GROUPS=(
  "/ecs/logjam-topo-worker"
  "/ecs/logjam-topo-export-worker"
)

if ! aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  echo "ERROR: AWS profile '$PROFILE' is not configured or has no valid credentials." >&2
  exit 1
fi

for group in "${LOG_GROUPS[@]}"; do
  echo "Setting ${RETENTION_DAYS}-day retention on ${group} ..."
  aws logs put-retention-policy \
    --log-group-name "$group" \
    --retention-in-days "$RETENTION_DAYS" \
    --profile "$PROFILE" \
    --region "$REGION"
done

echo "Done. Verify with:"
echo "  aws logs describe-log-groups --profile $PROFILE --region $REGION \\"
echo "    --query 'logGroups[].{name:logGroupName,retention:retentionInDays}'"
echo "Then restore the 90-day ceiling wording in frontend/public/privacy.html (Retention section)."
