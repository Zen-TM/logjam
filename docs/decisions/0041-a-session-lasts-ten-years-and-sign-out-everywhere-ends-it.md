# 0041. A Cognito session lasts ten years, and Sign out everywhere is how one ends

- **Date:** 2026-10-24
- **Status:** Accepted
- **Supersedes:** —

## Context

The app client in `infra/terraform/envs/prod/cognito.tf` issued a 5-day
refresh token. Past day five the first online refresh fails with
`NotAuthorizedException`, which `mobile/src/auth/sessionErrors.ts` classifies
as `rejected` and drops Logjam GPS to the sign-in screen, often at a trailhead
with no reception to sign in with. The same client serves Logjam Web.

Cognito fixes a refresh token's expiry at first sign-in: rotation does not
extend it, so any finite lifetime ends in the same forced sign-in. The maximum
is 10 years.

A password change does not end a session. On 2026-10-24, against a throwaway
account in the prod pool, a refresh token still refreshed after
`ChangePassword`. AWS lists `RevokeToken`, `GlobalSignOut`,
`AdminUserGlobalSignOut` and disabling the user as the ways a refresh token
ends. Amplify's `signOut({ global: true })` calls `GlobalSignOut` but swallows
its failure and still clears the local tokens.

## Decision

- `refresh_token_validity` is 3650 days (the maximum) for the one app client.
  It stays that long only while "Sign out everywhere" exists on both clients.
- "Sign out everywhere" (`useAuth.signOutEverywhere` in `frontend/`,
  `signOutEverywhereAtProvider` in `mobile/src/auth/oidcSession.ts`) calls `GlobalSignOut`, which
  revokes every refresh token the user holds.
- It forces a token refresh first and aborts, clearing and wiping nothing, if
  that fails (`assertCanSignOutEverywhere` on Logjam GPS). Guards:
  `mobile/src/auth/signOutSequence.test.ts`, `frontend/src/useAuth.test.tsx`.

## Consequences

- **Positive:** a session ends only when the user or an admin ends it, so a
  phone out of reception keeps its places, tracks and downloaded regions.
- **Negative:** a lost phone stays signed in until its owner signs out
  everywhere from another device, or an admin runs `AdminUserGlobalSignOut`.
  Changing or resetting the password does not do it. Logjam Web sessions are
  ten years long too. Tokens issued before the change keep their 5-day expiry,
  so each user has one more forced sign-in.
- **Neutral:** the button needs a connection. A global sign-out whose final
  `GlobalSignOut` call fails after the refresh succeeds still looks like
  success; the forced refresh makes that window narrow, not zero.

## Alternatives considered

- **A shorter lifetime (90 to 365 days).** The obvious middle. Rejected: the
  window is fixed from sign-in, so every user still meets the forced sign-in
  eventually, possibly offline.
- **A separate app client for Logjam GPS,** leaving Logjam Web short. Rejected
  for the upkeep: a second client in `cognito.tf`, an audience list in
  `api/src/middleware/auth.ts` and the env files, and a mobile rebuild, to
  narrow an exposure that "Sign out everywhere" already closes. Revisit if
  Logjam Web sessions need to be short.
- **Relying on a password change to end sessions.** It does not; see Context.
