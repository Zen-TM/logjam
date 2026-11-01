# 0045. Sign-in happens on the OIDC provider's page, and a deployment has one issuer

- **Date:** 2026-11-01
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam Web and Logjam GPS drew their own sign-up, verification, sign-in and
reset screens and called Amplify's Cognito functions, and each user was keyed
by `User.cognitoId` (`api/prisma/schema.prisma`). Another identity provider was
blocked in the clients even once the API's token check was neutral (#429).
Cognito does not export password hashes, so moving off it later would also have
meant rewriting both clients.

Cognito's Managed Login is an OIDC provider, so prod can stay on Cognito while
the clients speak only the standard flow. Its sign-up page cannot ask for a
username, the terms or the 18+ confirmation, and prod's pool had no domain.

Logjam GPS has no public release, so no old build needs the Amplify flow
(the installed build keeps working until it is upgraded, #728).

## Decision

- **Neither client handles a password.** Sign-in, sign-up, email verification,
  reset and MFA happen on the provider's page, by authorization code + PKCE
  (`frontend/src/auth/oidc.ts`, `mobile/src/auth/oidcSession.ts`). Amplify is
  not a dependency of either client. No test forbids a password field; review
  holds this.
- **Logjam Web's first page stays Logjam's.** `frontend/src/components/SignIn.tsx`
  keeps the terrain and the intro over one button, for any provider. No test
  holds the terrain (`frontend/src/components/SignIn.test.tsx` mocks it).
- **One deployment accepts one issuer, and `User.subject` is the key.** There
  is no identities table. An email never links accounts, except the rebind in
  `api/src/routes/users.ts`, which needs a verified email and the provider
  confirming the old subject is gone. Guard:
  `api/src/routes/usersRebind.unit.test.ts`.
- **What the provider's sign-up cannot ask, `ConsentGate` asks** before any
  user data loads (`shared/src/consentForm.ts`, `frontend/src/consent.test.ts`).
  Until then the account's name is neutral, `user-` plus a hash of the subject,
  and never comes from the email (`initialUsernameFor`). Guard:
  `api/src/routes/users.unit.test.ts`.
- **Whatever the standard does not cover is a provider extra, chosen from the
  issuer.** Change email and Sign out everywhere appear only for a Cognito
  issuer (`shared/src/cognitoAccount.ts`). The API removes the identity on
  account delete through `identityProvider()`, which is a no-op for an issuer
  with no adapter (`api/src/lib/identityProvider.ts`); Logjam's data goes first
  either way. Guard: `api/src/lib/identityProvider.unit.test.ts`.
- **Prod's Managed Login uses the prefix domain `logjamnsw`, with Logjam's
  branding** (`infra/terraform/envs/prod/cognito.tf`).

## Consequences

- **Positive:** Logjam's code holds no password. A deployment can use any OIDC
  provider by changing build env and the API's `OIDC_ISSUER` and
  `OIDC_AUDIENCE`, and a later move off Cognito needs no client rewrite. Reset, verification and MFA are the
  provider's to keep secure.
- **Negative:**
  - The sign-in form no longer sits on the terrain: Managed Login shows a
    plain branded card at an `amazoncognito.com` address, and each provider
    looks like itself, which can read as leaving Logjam. Signing in is one
    click longer, and a new account answers a second form after the first.
  - Copy, layout and error text on that page are the provider's.
  - The clients depend on the provider's hosted page being up.
  - Every Logjam Web session signed in with Amplify signs in once more.
  - Under an issuer with no adapter, the identity outlives a deleted account
    until its operator removes it. Such an issuer also needs its origin added
    to `CSP_PROD` in `frontend/vite.config.ts` and to `scripts/csp-policy.json`.
  - Only Cognito has been run end to end; another issuer is proven by unit
    tests alone until someone deploys one.
  - Leaving Cognito still means a password reset for every user or a lazy
    migration, and matching users to new subjects needs its own design.
- **Neutral:** the Cognito email-sender Lambda and the pool's users are
  unchanged. `ALLOW_USER_SRP_AUTH` and the `COGNITO_*` settings stay until the
  installed build is upgraded (#728).

## Alternatives considered

- **Keep Amplify and the in-app forms.** Least work and full control of copy
  and of the sign-in form over the terrain, but clients and users stay tied to
  Cognito and leaving it stays a client rewrite.
- **Amplify with another provider federated into Cognito.** The clients still
  depend on Cognito and Amplify.
- **Logjam runs its own auth.** No provider at all, but one maintainer would
  own password storage, reset, MFA and abuse protection.
- **An identities table of issuer + subject.** It would allow two issuers at
  once, which no deployment needs; a move off Cognito designs its own linking.
- **Keep the old first-login fallback, the email's local part.** Managed Login
  sends no username, so every new account would have published part of its
  email as a visible name.
- **A custom domain such as `auth.logjamnsw.com`.** It would show Logjam's own
  address, but it needs a certificate and DNS outside Terraform today.
- **Keep Amplify until old builds retire, and adopt their refresh tokens.** The
  plan while Logjam GPS was assumed released; with one install to upgrade by
  hand it was code with no user.
