import { beforeEach, describe, expect, it, vi } from "vitest";

// The fix rate is the single biggest battery lever the app has, so two things
// are pinned here: the DEFAULT (a fresh install must not record at the finest
// rate for a whole trip), and the fact that every rate offered by
// FIX_RATE_OPTIONS actually round-trips through the preference store — the
// "two lists that must agree" rule, now that the accepted-values list is
// derived from the options table rather than hand-kept beside it.

let storedValue: string | null = null;

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn((_key: string, value: string) => {
    storedValue = value;
    return true;
  }),
}));

vi.mock("expo-location", () => ({ Accuracy: { High: 4 } }));

const { FIX_RATE_OPTIONS, readFixRate, writeFixRate } = await import(
  "./recordingPreferences"
);

beforeEach(() => {
  storedValue = null;
});

describe("fix rate preference", () => {
  it("defaults to the battery-saver rate, not the finest one", () => {
    expect(readFixRate()).toBe("battery");
  });

  it("falls back to the default when the stored value is unknown", () => {
    storedValue = "turbo";
    expect(readFixRate()).toBe("battery");
  });

  it("round-trips every offered rate", () => {
    for (const rate of Object.keys(FIX_RATE_OPTIONS)) {
      writeFixRate(rate as keyof typeof FIX_RATE_OPTIONS);
      expect(readFixRate()).toBe(rate);
    }
  });

  it("asks for positions less often as the rate gets cheaper", () => {
    const intervals = Object.values(FIX_RATE_OPTIONS).map((o) => o.timeInterval);
    expect(intervals).toEqual([...intervals].sort((a, b) => Number(a) - Number(b)));
  });
});
