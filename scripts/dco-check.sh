#!/usr/bin/env bash
# The DCO check .github/workflows/dco.yml runs on every pull request: each
# non-merge commit in <range> needs a Signed-off-by trailer whose email matches
# the commit's author email (ADR 0021).
#
#   PR_AUTHOR=<login of the PR opener> dco-check.sh <base>..<head>
#   dco-check.sh --self-test
#
# Dependabot is exempt (a bot cannot certify the DCO), but only for a commit
# that is Dependabot's on a PR Dependabot opened. Both conditions are needed:
# the PR opener alone would let a human's commit ride on a Dependabot branch,
# and the author email alone would let anyone skip the check by setting their
# git author email. The exemption FAILS CLOSED: any other combination is
# checked as usual.
#
# Mutations the self-test catches: dropping the PR_AUTHOR condition turns
# "human PR, Dependabot-authored commit" red; dropping the author-email
# condition turns "Dependabot PR, unsigned human commit" red.
set -uo pipefail

DEPENDABOT_LOGIN="dependabot[bot]"
DEPENDABOT_EMAIL="49699333+dependabot[bot]@users.noreply.github.com"

# check_range <range> <PR opener's login>: exit 1 if a commit lacks a sign-off.
check_range() {
  local range=$1 pr_author=$2 commit author_email line matched
  local offending=()
  echo "Checking DCO sign-off for commit range: $range"

  while IFS= read -r commit; do
    [ -z "$commit" ] && continue
    author_email="$(git log -1 --format="%ae" "$commit")"
    if [ "$pr_author" = "$DEPENDABOT_LOGIN" ] && [ "${author_email,,}" = "${DEPENDABOT_EMAIL,,}" ]; then
      echo "Skipping $commit: authored by Dependabot"
      continue
    fi
    matched=false
    while IFS= read -r line; do
      if [[ "${line,,}" == *"<${author_email,,}>"* ]] || [[ "${line,,}" == *" ${author_email,,}" ]]; then
        matched=true
        break
      fi
    done < <(git log -1 --format="%B" "$commit" | grep -i "^Signed-off-by:" || true)

    if [ "$matched" = false ]; then
      offending+=("$commit")
    fi
  done < <(git rev-list --no-merges "$range")

  if [ ${#offending[@]} -gt 0 ]; then
    echo "::error::The following commit(s) are missing a Signed-off-by trailer matching their author email:" >&2
    for commit in "${offending[@]}"; do
      git log -1 --format="  commit %H%n  Author: %an <%ae>%n  Date:   %ad%n%n    %s%n" "$commit" >&2
    done
    return 1
  fi

  echo "All commits in $range have a valid Signed-off-by line."
}

self_test() {
  local fails=0 dir base
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' RETURN
  # Own the git environment: a CI runner has no identity, and a developer's
  # config (signing, hooks) must not change what the fixtures commit.
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@x.io
  git init -q "$dir"
  cd "$dir" || return 1
  # commit <author email> <message...>
  commit() {
    local email=$1; shift
    git -c user.name=t -c user.email="$email" -c commit.gpgsign=false \
      commit -q --allow-empty "$@"
  }
  # check <description> <expected: pass|fail> <PR opener's login>
  check() {
    local desc=$1 want=$2 opener=$3 got=fail
    check_range "$base..HEAD" "$opener" > /dev/null 2>&1 && got=pass
    if [ "$got" = "$want" ]; then echo "ok   — $desc"; else echo "FAIL — $desc: want $want, got $got"; fails=1; fi
  }

  commit base@x.io -m base
  base=$(git rev-parse HEAD)

  commit "$DEPENDABOT_EMAIL" -m bump -m "Signed-off-by: dependabot[bot] <support@github.com>"
  check "Dependabot PR, Dependabot commit"                      pass "$DEPENDABOT_LOGIN"
  check "human PR, Dependabot-authored commit"                  fail alice

  git reset -q --hard "$base"
  commit "$DEPENDABOT_EMAIL" -m "spoofed author"
  check "human PR, unsigned commit with Dependabot's email"     fail mallory

  git reset -q --hard "$base"
  commit "$DEPENDABOT_EMAIL" -m bump
  commit a@x.io -m "unsigned human fix"
  check "Dependabot PR, unsigned human commit"                  fail "$DEPENDABOT_LOGIN"
  git commit -q --amend --allow-empty -m "human fix" -m "Signed-off-by: alice <a@x.io>"
  check "Dependabot PR, signed human commit"                    pass "$DEPENDABOT_LOGIN"

  git reset -q --hard "$base"
  commit a@x.io -m "signed" -m "Signed-off-by: alice <a@x.io>"
  check "human PR, signed commit"                               pass alice
  git commit -q --amend --allow-empty -m "signed as someone else" -m "Signed-off-by: bob <b@x.io>"
  check "human PR, sign-off email differs from author"          fail alice
  git reset -q --hard "$base"
  commit a@x.io -m "unsigned"
  check "human PR, unsigned commit"                             fail alice
  check "PR opener unknown, unsigned commit"                    fail ""

  return "$fails"
}

case "${1:-}" in
  --self-test) self_test ;;
  "") echo "usage: PR_AUTHOR=<login> $0 <base>..<head> | $0 --self-test" >&2; exit 2 ;;
  *) check_range "$1" "${PR_AUTHOR:-}" ;;
esac
