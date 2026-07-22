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
import * as Sentry from "@sentry/react-native";

import { scrubBreadcrumb, scrubEvent } from "./scrubEvent";

export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // reporter absent until the operator provisions a DSN

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
