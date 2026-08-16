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

// grandfatherCrashReports lives beside initSentry, which pulls the native SDK.
vi.mock("@sentry/react-native", () => ({ init: vi.fn() }));

const { areCrashReportsEnabled, needsCrashReportChoice, readCrashReportChoice, setCrashReportsEnabled } =
  await import("./crashReportPreference");
const { grandfatherCrashReports } = await import("./initSentry");

describe("crash report consent", () => {
  beforeEach(() => store.clear());

  // The distinction the whole mechanism rests on: "said no" is not "never
  // asked". Collapse them and grandfathering silently re-enables a reporter the
  // user turned off.
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

  it("grandfathers an install that predates the toggle", () => {
    grandfatherCrashReports();
    expect(areCrashReportsEnabled()).toBe(true);
    expect(needsCrashReportChoice()).toBe(false);
  });

  it("never overwrites an explicit no", () => {
    setCrashReportsEnabled(false);
    grandfatherCrashReports();
    expect(areCrashReportsEnabled()).toBe(false);
  });
});
