# 0045. Clients speak OIDC, Logjam Web keeps its own forms under Cognito, and a deployment has one issuer

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
the clients speak the standard flow. Its sign-up page cannot ask for a username,
the terms or the 18+ confirmation, and prod's pool had no domain.

Logjam GPS has no public release, so no old build needs the Amplify flow
(the installed build keeps working until it is upgraded, #728).

## Decision

- **Both clients can sign in through any OIDC provider's page**, by
  authorization code + PKCE (`frontend/src/auth/oidc.ts`,
  `mobile/src/auth/oidcSession.ts`). Amplify is not a dependency of either
  client. Logjam GPS always signs in this way.
- **Under a Cognito issuer, Logjam Web signs in, signs up and resets a password
  on its own landing page**, in `frontend/src/components/SignIn.tsx`, over the
  plain fetch calls in `shared/src/cognitoAccount.ts` to Cognito's public API,
  never through Logjam's API. Under any other issuer that page is one button to
  the provider. Guard: `frontend/src/components/SignIn.test.tsx`. A password
  stays in component state and is never stored. Guard:
  `frontend/src/auth/oidc.test.ts`.
- **The provider's page is the fallback.** A challenge the form cannot answer
  (MFA, a forced new password), or a failure that is not Cognito's answer about
  this attempt (`FORM_ANSWERS` in `frontend/src/useAuth.ts`), hands over to it.
  Guard: `frontend/src/useAuth.test.tsx`.
- **Both ways in end in one session**, the shape `oidc-client-ts` stores, so
  refresh and sign-out never ask which it was. Guard:
  `frontend/src/auth/oidc.test.ts`.
- **One deployment accepts one issuer, and `User.subject` is the key.** There
  is no identities table. An email never links accounts, except the rebind in
  `api/src/routes/users.ts`, which needs a verified email and the provider
  confirming the old subject is gone. Guard:
  `api/src/routes/usersRebind.unit.test.ts`.
- **What a provider's sign-up cannot ask, `ConsentGate` asks** before any user
  data loads (`shared/src/consentForm.ts`, `frontend/src/consent.test.ts`).
  Logjam Web's own sign-up form asks up front and records it at first sign-in;
  if that fails, the gate asks. Until then the account's name is neutral, `user-`
  plus a hash of the subject, and never comes from the email
  (`initialUsernameFor`). Guard: `api/src/routes/users.unit.test.ts`.
- **Whatever the standard does not cover is a provider extra, chosen from the
  issuer.** Change email and Sign out everywhere appear only for a Cognito
  issuer (`shared/src/cognitoAccount.ts`). The API removes the identity on
  account delete through `identityProvider()`, which is a no-op for an issuer
  with no adapter (`api/src/lib/identityProvider.ts`); Logjam's data goes first
  either way. Guard: `api/src/lib/identityProvider.unit.test.ts`.
- **Prod's Managed Login uses the prefix domain `logjamnsw`, with Logjam's
  branding** (`infra/terraform/envs/prod/cognito.tf`).

## Consequences

- **Positive:** the landing page stays the way in, with no extra click, and a
  saved password still autofills on Logjam's own domain. A deployment can use
  any OIDC provider by changing build env and the API's `OIDC_ISSUER` and
  `OIDC_AUDIENCE`, and a later move off Cognito drops the forms rather than
  rewriting a client. MFA on the pool would work through the fallback.
- **Negative:**
  - Logjam Web's code sees the password under Cognito, so an XSS on the page
    could read one. `USER_AUTH` sends it to Cognito over TLS, where Amplify's
    SRP sent a proof. `ALLOW_USER_AUTH` must stay on the app client.
  - Two ways in to keep working, and about 400 lines of forms that exist for
    one provider.
  - Logjam GPS and any other issuer still get the provider's page, whose copy
    is the provider's, and a new account answers a second form afterwards. They
    depend on that page being up.
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

- **The provider's page for everyone.** The only option where no Logjam code
  sees a password, and built first. Tried on a throwaway pool, it made the
  landing page a pointless extra click, stopped saved passwords autofilling and
  read as a regression.
- **Embed Managed Login in the landing page.** Cognito refuses it, with
  `X-Frame-Options: DENY` and `frame-ancestors 'none'`.
- **Sign in on the page, and send sign-up and reset to the provider.** Less
  code, but a new user's first minutes would leave Logjam.
- **Keep Amplify and the in-app forms.** Keeps SRP, but clients and users stay
  tied to Cognito and leaving it stays a client rewrite. Plain fetch needs a few
  calls and no SDK.
- **Amplify with another provider federated into Cognito.** The clients still
  depend on Cognito and Amplify.
- **Logjam runs its own auth.** No provider at all, but one maintainer would
  own password storage, reset, MFA and abuse protection.
- **An identities table of issuer + subject.** It would allow two issuers at
  once, which no deployment needs; a move off Cognito designs its own linking.
- **Keep the old first-login fallback, the email's local part.** Managed Login
  sends no username, so every account made there would have published part of
  its email as a visible name.
- **A custom domain such as `auth.logjamnsw.com`.** It would show Logjam's own
  address, but it needs a certificate and DNS outside Terraform today.
- **Keep Amplify until old builds retire, and adopt their refresh tokens.** The
  plan while Logjam GPS was assumed released; with one install to upgrade by
  hand it was code with no user.
