#!/usr/bin/env bash
# Fails a store build or an OTA update before it starts when its EAS environment
# lacks what a real-auth build needs. Either would otherwise succeed, and every
# launch of it would then throw (assertOidcConfigured, index.ts).
#
# Usage:  scripts/check-eas-env.sh <preview|production>
set -euo pipefail

environment=$1
vars=$(eas env:list --environment "$environment" --format short)
for v in EXPO_PUBLIC_OIDC_ISSUER EXPO_PUBLIC_OIDC_CLIENT_ID; do
  grep -q "^$v=." <<<"$vars" || {
    echo "$v is not set in the EAS $environment environment" >&2
    exit 1
  }
done
