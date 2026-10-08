import { beforeEach, describe, expect, it, vi } from "vitest";

// prefsDb reaches for expo-sqlite, which throws outside a native runtime. An
// in-memory stand-in keeps this a pure test of the tri-state consent mechanism:
// what the reporter does, and when the app is allowed to ask.
const store = new Map<string, string>();
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => store.get(key) ?? null,
  writePref: (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));

const {
  areCrashReportsEnabled,
  needsCrashReportChoice,
  readCrashReportChoice,
  setCrashReportsEnabled,
} = await import("./crashReportPreference");

describe("crash report consent", () => {
  beforeEach(() => store.clear());

  // The distinction the whole mechanism rests on: "said no" is not "never
  // asked". Collapse them and an explicit no gets asked again, or an unasked
  // install reads as having answered.
  it("reads a fresh install as unset, and off", () => {
    expect(readCrashReportChoice()).toBe("unset");
    expect(areCrashReportsEnabled()).toBe(false);
  });

  it("asks only an install that has never been asked", () => {
    expect(needsCrashReportChoice()).toBe(true);
    setCrashReportsEnabled(false);
    expect(needsCrashReportChoice()).toBe(false);
  });

  // "Not now" stores an explicit off, which is what stops the dialog coming
  // back on every launch — the answer is a real answer, not a deferral.
  it("does not ask again after either answer", () => {
    setCrashReportsEnabled(true);
    expect(needsCrashReportChoice()).toBe(false);
    expect(areCrashReportsEnabled()).toBe(true);
  });

  // Consent before telemetry: an install that already has a stored identity
  // but no recorded choice must report nothing and still be asked. Red if
  // anything writes "on" for an unset install (e.g. a restored grandfathering
  // call in the auth restore path, simulated by calling setCrashReportsEnabled(true)
  // before the reads), or if needsCrashReportChoice stops keying on "unset".
  it("keeps reporting off and asks an install that has an identity but no choice", () => {
    // Nothing in the identity store feeds the choice, so the empty prefs store
    // here IS that install.
    expect(readCrashReportChoice()).toBe("unset");
    expect(areCrashReportsEnabled()).toBe(false);
    expect(needsCrashReportChoice()).toBe(true);
  });
});
