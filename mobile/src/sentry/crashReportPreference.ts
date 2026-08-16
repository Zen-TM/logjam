// Whether crash reports may leave this device.
//
// Root CLAUDE.md: "No analytics/telemetry leaving user account." A guest has no
// account, so shipping their crashes to Sentry has nothing to leave *to* — the
// rule can only be honoured by asking. `CrashReportConsent` asks ONCE, the first
// time the app itself is reached (guest or signed in), **defaulting to off**,
// and Sentry does not initialise until it is answered.
//
// An install that already has a local identity is treated as having consented:
// those users signed up under the previous behaviour where the reporter was
// always on, and re-prompting them changes nothing about what has already been
// sent. Only the chooser path is new, and only it asks.
//
// PRIVACY: one boolean. The reporter it gates is separately scrubbed
// (scrubEvent.ts) — this decides whether it runs at all, not what it sends.
import { readPref, writePref } from "../prefsDb";

const CRASH_REPORTS_PREF_KEY = "crashReportsEnabled";

export type CrashReportChoice = "on" | "off" | "unset";

/**
 * The stored choice, distinguishing "said no" from "never asked". The
 * distinction matters exactly once: grandfathering an install that predates the
 * toggle must fill an absent preference without overriding an explicit no.
 */
export function readCrashReportChoice(): CrashReportChoice {
  const stored = readPref(CRASH_REPORTS_PREF_KEY);
  if (stored === "on") return "on";
  if (stored === "off") return "off";
  return "unset";
}

/**
 * Synchronous: `initSentry` runs at module scope from `index.ts`, before any
 * `await` exists. Only an explicit "on" enables the reporter — a missing store,
 * a corrupt value and a fresh install all read as OFF (fail-safe, unlike the
 * app lock's deliberately-off default which trades privacy for field friction).
 */
export function areCrashReportsEnabled(): boolean {
  return readCrashReportChoice() === "on";
}

/**
 * Whether to put the one-time consent dialog in front of the user.
 *
 * "Never asked" is the only state that asks — which is what keeps the dialog
 * from being a nag: both of its answers (including "Not now", which stores an
 * explicit off) leave a stored choice behind, and Settings → Privacy and
 * security owns it from then on. Grandfathered installs read "on" here and are
 * never asked either.
 */
export function needsCrashReportChoice(): boolean {
  return readCrashReportChoice() === "unset";
}

/** Returns false when the preference could not be stored. */
export function setCrashReportsEnabled(enabled: boolean): boolean {
  return writePref(CRASH_REPORTS_PREF_KEY, enabled ? "on" : "off");
}
