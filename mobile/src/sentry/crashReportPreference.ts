// Whether crash reports may leave this device.
//
// Root CLAUDE.md: "No analytics/telemetry leaving user account." A guest has no
// account, so shipping their crashes to Sentry has nothing to leave *to* — the
// rule can only be honoured by asking. `CrashReportConsent` asks ONCE, the first
// time the app itself is reached (guest or signed in), **defaulting to off**,
// and Sentry does not initialise until it is answered.
//
// No install is treated as having consented. One with a stored identity and no
// answer reads "unset" like a fresh one: reporting stays off and the sheet asks.
//
// PRIVACY: one boolean. The reporter it gates is separately scrubbed
// (scrubEvent.ts) — this decides whether it runs at all, not what it sends.
import { readPref, writePref } from "../prefsDb";

const CRASH_REPORTS_PREF_KEY = "crashReportsEnabled";

export type CrashReportChoice = "on" | "off" | "unset";

/**
 * The stored choice, distinguishing "said no" from "never asked". Only
 * "unset" asks; an explicit no is an answer, not a gap to fill.
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
 * security owns it from then on.
 */
export function needsCrashReportChoice(): boolean {
  return readCrashReportChoice() === "unset";
}

/** Returns false when the preference could not be stored. */
export function setCrashReportsEnabled(enabled: boolean): boolean {
  return writePref(CRASH_REPORTS_PREF_KEY, enabled ? "on" : "off");
}
