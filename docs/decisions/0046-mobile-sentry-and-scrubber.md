# 0046. Mobile crash reporting: Sentry behind a scrubber and a consent gate

- **Date:** 2026-07-23
- **Status:** Accepted
- **Supersedes:** —

## Context

Root privacy rules: no analytics/telemetry leaving the user's account, and logs
and errors must not carry place coordinates, names, tags or field values. A
crash reporter is telemetry by definition. The mobile rule was that the
crash/error reporter scrubs coords/names (mirror `api/src/lib/logger.ts`) —
wired from day one, before any reporter ships. Sentry and its scrubber arrived
together in Stage 1 (2026-07-23).

## Decision

As shipped (`src/sentry/`):

- **The scrubber is pure and tested.** `scrubEvent.ts` (guard:
  `scrubEvent.test.ts`) is wired as `beforeSend` / `beforeBreadcrumb` by
  `initSentry.ts`. It mirrors `api/src/lib/logger.ts` in three layers: strip
  URLs, decimal lat/lng pairs and z/x/y tile triples from every free-text field;
  drop stack-embedded argument blocks from exception messages; and censor
  coordinate/name-shaped keys — including user-authored field labels and values
  — at any depth in breadcrumb data, extra and contexts.
- `sendDefaultPii: false`, `tracesSampleRate: 0`: crash-only, no performance
  tracing or session replay.
- No-op when `EXPO_PUBLIC_SENTRY_DSN` is unset.
- **Crash reports are consent-gated** (`sentry/crashReportPreference.ts`): a
  guest has no account for telemetry to "stay within", so `initSentry()` no-ops
  until the question is answered (default OFF). It is asked ONCE, as a sheet
  mounted from `App.tsx` beside `AppShell` (`screens/CrashReportConsent
  .tsx`), on the first arrival into the app — guest or signed in. Both answers
  (including "Not now", an explicit off) store a choice, which is what stops it
  nagging; `needsCrashReportChoice()` is the whole decision and is tested in
  `sentry/crashReportPreference.test.ts`. Installs that predate the toggle are
  grandfathered by `grandfatherCrashReports()`, and an explicit no is never
  overwritten.
- **Sentry sourcemap upload is OFF** (`SENTRY_DISABLE_AUTO_UPLOAD=true` in the
  build profiles). The Sentry Gradle plugin fails the build outright when it has
  no org/project/auth token, and those need operator setup.
- **A LOCAL release build must pass `SENTRY_DISABLE_AUTO_UPLOAD=true` itself.**
  The flag lives in `eas.json`'s build profiles, so a cloud build inherits it and
  `./gradlew :app:assembleRelease` on a dev box does not: the Sentry gradle task
  runs, `sentry-cli` fails, and the build dies at
  `createBundleReleaseJsAndAssets_SentryUpload` — long after the slow tasks, for
  a step nothing needs. Prefix the command with the flag (this is also what the
  EAS profiles do, so the artifact is identical). `scripts/build-local-apk.sh`
  sets it.

## Consequences

- **Positive:** no place coordinates or names leave the device in a crash
  report; nothing is sent without consent.
- **Negative:** crash reports from a release build arrive with minified Hermes
  frames — the reporter works, the stack traces are close to unreadable.
- **Neutral:** to turn sourcemaps on: add `organization` + `project` to the
  `@sentry/react-native` plugin config in `app.json`, put the Sentry auth token
  in an EAS secret (`SENTRY_AUTH_TOKEN`, secret-visibility — it IS a real
  credential, unlike the DSN), and drop the disable flag.

## Alternatives considered

Not recorded.
