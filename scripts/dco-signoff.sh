#!/usr/bin/env bash
# Appends a Developer Certificate of Origin (DCO) Signed-off-by trailer for the
# current git user to the commit message file if not already present.
# Invoked by the prepare-commit-msg git hook with the message file path as $1.
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

signoff="Signed-off-by: $name <$email>"

# Avoid duplicate trailers when amending or if sign-off is already in the message
if grep -qxF "$signoff" "$msg_file"; then
  exit 0
fi

# Append trailer with a preceding blank line if the message has content
if [ ! -s "$msg_file" ]; then
  printf '%s\n' "$signoff" >> "$msg_file"
else
  if [ -n "$(tail -c 1 "$msg_file")" ]; then
    printf '\n' >> "$msg_file"
  fi
  if [ -n "$(tail -n 1 "$msg_file")" ]; then
    printf '\n%s\n' "$signoff" >> "$msg_file"
  else
    printf '%s\n' "$signoff" >> "$msg_file"
  fi
fi
