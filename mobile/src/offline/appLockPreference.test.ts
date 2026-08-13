import { beforeEach, describe, expect, it, vi } from "vitest";

// FLAG_SECURE has to follow the app-lock preference and nothing else: armed
// while the lock is on (the recents thumbnail of the map screen is readable by
// exactly the person the lock exists to stop), released when it is off
// (screenshotting a map is a legitimate field workflow, and the operator chose
// not to make it app-wide). Neither half is observable in a screenshot test, so
// assert the calls.

let storedValue: string | null = null;

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn((_key: string, value: string) => {
    storedValue = value;
    return true;
  }),
}));

const authenticate = vi.fn(async () => ({ success: true }) as { success: boolean });
vi.mock("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0 },
  getEnrolledLevelAsync: vi.fn(async () => 2),
  authenticateAsync: (...args: unknown[]) => authenticate(...(args as [])),
}));

const preventScreenCaptureAsync = vi.fn(async () => {});
const allowScreenCaptureAsync = vi.fn(async () => {});
vi.mock("expo-screen-capture", () => ({
  preventScreenCaptureAsync: (...args: unknown[]) =>
    preventScreenCaptureAsync(...(args as [])),
  allowScreenCaptureAsync: (...args: unknown[]) =>
    allowScreenCaptureAsync(...(args as [])),
}));

const { applyScreenCapturePolicy, isAppLockEnabled, setAppLockEnabled } =
  await import("./appLockPreference");

beforeEach(() => {
  storedValue = null;
  preventScreenCaptureAsync.mockClear();
  allowScreenCaptureAsync.mockClear();
  authenticate.mockClear();
  authenticate.mockResolvedValue({ success: true });
});

describe("FLAG_SECURE follows the app lock", () => {
  it("blocks screen capture when the lock is turned on", async () => {
    const result = await setAppLockEnabled(true);
    expect(result).toEqual({ status: "changed", enabled: true });
    expect(preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(allowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it("releases it when the lock is turned off", async () => {
    await setAppLockEnabled(true);
    preventScreenCaptureAsync.mockClear();
    await setAppLockEnabled(false);
    expect(allowScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(preventScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it("re-applies the stored preference at startup", async () => {
    // FLAG_SECURE is per-process; the preference is what persists.
    storedValue = "on";
    await applyScreenCapturePolicy();
    expect(preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });

  it("leaves capture alone for the default-off install", async () => {
    storedValue = null;
    await applyScreenCapturePolicy();
    expect(preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(allowScreenCaptureAsync).toHaveBeenCalledTimes(1);
  });
});

describe("the off-requires-auth asymmetry still holds", () => {
  it("does not turn the lock off when the authenticator says no", async () => {
    await setAppLockEnabled(true);
    authenticate.mockResolvedValue({ success: false });
    const result = await setAppLockEnabled(false);
    expect(result.status).toBe("cancelled");
    expect(isAppLockEnabled()).toBe(true);
    // …and screen capture stays blocked, because the lock is still on.
    expect(allowScreenCaptureAsync).not.toHaveBeenCalled();
  });

  it("turning it on needs no authentication", async () => {
    await setAppLockEnabled(true);
    expect(authenticate).not.toHaveBeenCalled();
    expect(isAppLockEnabled()).toBe(true);
  });
});
