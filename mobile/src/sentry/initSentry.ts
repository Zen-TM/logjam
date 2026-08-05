// Sentry crash reporting — privacy-gated init (PROGRESS.md Stage 0 decision).
//
// Hard preconditions honoured here:
//  - scrubEvent/scrubBreadcrumb (pure, vitest-covered) wired as beforeSend /
//    beforeBreadcrumb — no canyon coords/names/URLs leave the device.
//  - sendDefaultPii: false.
//  - No-op when EXPO_PUBLIC_SENTRY_DSN is unset (operator hasn't created the
//    Sentry org yet — OPERATOR_SETUP.md B). The DSN is not a secret (it's a
//    submission endpoint), so EXPO_PUBLIC_* is the right channel; the Sentry
//    *auth token* (sourcemap upload) is a secret and stays in EAS secrets.
//  - No-op until the user has said yes (crashReportPreference.ts). Guest mode
//    made this necessary: telemetry with no account behind it has nothing to
//    "leave the user's account" *to*, so consent is the only way to honour the
//    root privacy rule. Existing signed-in users are grandfathered by
//    `grandfatherCrashReports` below.
import * as Sentry from "@sentry/react-native";

import {
  areCrashReportsEnabled,
  readCrashReportChoice,
  setCrashReportsEnabled,
} from "./crashReportPreference";
import { scrubBreadcrumb, scrubEvent } from "./scrubEvent";

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // reporter absent until the operator provisions a DSN
  if (!areCrashReportsEnabled()) return; // not consented (or not yet asked)

  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Network breadcrumbs survive but their URLs are scrubbed (a tile URL is
    // an approximate coordinate).
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    // Crash-only posture for now: no performance tracing, no session replay —
    // each would add request/URL telemetry that widens the scrub surface.
    tracesSampleRate: 0,
  });
}

/**
 * Grandfather an install that predates the consent toggle: someone who was
 * already signed in agreed to nothing explicitly, but the reporter has been
 * running for them since day one and re-asking changes nothing about what has
 * already been sent. Only fills an ABSENT preference — a user who has since
 * turned reports off stays off.
 *
 * Takes effect on the next cold start, because `initSentry` runs at module
 * scope before any session is known. One session of missing crash reports for
 * upgrading users is the price of not calling `Sentry.init` twice.
 */
export function grandfatherCrashReports(): void {
  if (readCrashReportChoice() === "unset") setCrashReportsEnabled(true);
}
