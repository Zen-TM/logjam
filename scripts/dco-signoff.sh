#!/usr/bin/env bash
# Appends a Developer Certificate of Origin (DCO) Signed-off-by trailer for the
# current git user to the commit message file if not already present.
# Invoked by the prepare-commit-msg git hook with the message file path as $1.
# interpret-trailers joins an existing trailer block (Co-authored-by, …) rather
# than starting a new paragraph, which would stop GitHub reading those trailers.
set -euo pipefail

msg_file="${1:-}"
if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
  exit 0
fi

name="$(git config user.name || true)"
email="$(git config user.email || true)"

if [ -z "$name" ] || [ -z "$email" ]; then
  echo "dco-signoff: git user.name and user.email must be configured" >&2
  exit 1
fi

git interpret-trailers --in-place --if-exists addIfDifferent \
  --trailer "Signed-off-by: $name <$email>" "$msg_file"
