# shellcheck shell=bash
# Sourced by the one-off task scripts (drill.sh, copy.sh): the ECS task role's
# credentials and one signed request to S3. The image has no aws CLI, and
# pgBackRest cannot write or read an arbitrary object, so curl signs it.
# BRAIN_BACKUP_ENDPOINT and BRAIN_BACKUP_VERIFY_TLS=n point it at an S3
# stand-in, as in pgbackrest-conf.sh. Guard: tests/e2e.sh (the drill and copy
# scenarios).

# Fargate has no instance metadata: the task role is behind a local URL.
# Exports AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN.
task_credentials() {
  [ -z "${AWS_ACCESS_KEY_ID:-}" ] || return 0
  [ -n "${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:-}${AWS_CONTAINER_CREDENTIALS_FULL_URI:-}" ] || return 0
  local uri=${AWS_CONTAINER_CREDENTIALS_FULL_URI:-http://169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI} creds
  creds=$(curl -fsS -m 10 "$uri" | jq -r '[.AccessKeyId, .SecretAccessKey, .Token] | @tsv') || creds=
  read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<< "$creds"
  [ -n "$AWS_SESSION_TOKEN" ] || { echo "cannot read the task's credentials" >&2; return 1; }
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
}

# s3_curl <bucket> <key> [file]: GET the object to stdout, or PUT the file.
# The payload hash is given so the signed headers are fixed.
s3_curl() {
  local bucket=$1 key=$2 file=${3:-} url hash
  if [ -n "${BRAIN_BACKUP_ENDPOINT:-}" ]; then
    url=https://$BRAIN_BACKUP_ENDPOINT/$bucket/$key
  else
    url=https://$bucket.s3.$AWS_REGION.amazonaws.com/$key
  fi
  if [ -n "$file" ]; then hash=$(sha256sum "$file" | cut -d' ' -f1); else hash=$(printf '' | sha256sum | cut -d' ' -f1); fi
  # The credentials reach curl as a config on a pipe, never in an argument list where ps shows them, as in
  # host/lib.sh's s3_curl; the image cannot source that file, as its build context is postgres/.
  local cfg
  cfg=$(printf 'user = "%s:%s"\n' "${AWS_ACCESS_KEY_ID:-}" "${AWS_SECRET_ACCESS_KEY:-}")
  [ -z "${AWS_SESSION_TOKEN:-}" ] || cfg+=$(printf '\nheader = "x-amz-security-token: %s"' "$AWS_SESSION_TOKEN")
  local args=(-fsS -m 30 --aws-sigv4 "aws:amz:$AWS_REGION:s3" -H "x-amz-content-sha256: $hash")
  [ "${BRAIN_BACKUP_VERIFY_TLS:-y}" != n ] || args+=(-k)
  if [ -n "$file" ]; then args+=(-H "content-type: application/json" -T "$file"); fi
  curl "${args[@]}" -K <(printf '%s\n' "$cfg") "$url"
}
