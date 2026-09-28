# Security and privacy

Logjam holds places its users have chosen not to publish. A bug that shows one
user's places to someone else is as serious as a login bypass, and this policy
treats it that way.

## Reporting

Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/Zen-TM/logjam/security/advisories/new).
Only the maintainer sees the report, and the fix is worked on in the same
private advisory.

If you cannot use GitHub, email
[zentmarcos@gmail.com](mailto:zentmarcos@gmail.com?subject=Logjam%20security)
with "Logjam security" in the subject.

Do not open a public issue, pull request or discussion about it, and do not
describe it in a commit message.

## What counts

Security problems, such as getting past sign-in, reaching another account,
injection, a leaked secret or a dependency flaw that Logjam actually reaches.

Privacy problems count the same. Anything that exposes, or would let someone
reach, data they were not given:

- a user's places: coordinates, names, notes, tags, attribute values or
  labels, tracks and photos;
- another user's data, including a sharee seeing more of a place than the
  share grants, or another user's email address;
- user data served without sign-in, or leaving the user's account in logs,
  error reports, URLs or anything else sent outside it;
- data Logjam GPS keeps on the phone that another app can read, or that
  survives signing out.

Not in scope: denial of service by volume, social engineering, and scanner
output or missing headers with no way to exploit them.

## Testing

- Test against your own accounts. To test sharing, make two. Better still, run
  Logjam locally, which comes with seeded users (`README.md` → Local
  Development).
- Never read, change or keep another user's data on the live service. If you
  reach some by accident, stop, keep no copy, and say so in your report.
- No load testing, no mass topo or export jobs (each one costs real money),
  and no emails to other users.

## What to expect

- An acknowledgement within 3 days.
- An assessment within a week: whether it is a vulnerability, how severe, and
  the plan.
- The fix is prepared in the private advisory, then deployed. The advisory is
  published once the fix is live, crediting you if you want the credit.
- Please keep the details private until the advisory is published, or for 90
  days from your report, whichever comes first. If a fix needs longer, we will
  ask.
- There is no bug bounty.

## Supported versions

- **Logjam Web and the API:** only what is deployed from `main`. Fixes land on
  `main` and deploy when merged; no older version is patched.
- **Logjam GPS:** the latest build. Older builds keep working for a while
  ([ADR 0022](docs/decisions/0022-mobile-builds-supported-three-months.md)),
  but a security fix ships only in a new build or an update to the latest.
- **Self-hosted copies:** fixes land on `main`; update from there. A flaw in
  the code is in scope wherever it runs.
