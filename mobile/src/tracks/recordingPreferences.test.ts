import { beforeEach, describe, expect, it, vi } from "vitest";

// The fix rate is the single biggest battery lever the app has, so two things
// are pinned here: the DEFAULT (a fresh install must not record at the finest
// rate for a whole trip), and the fact that every rate offered by
// FIX_RATE_OPTIONS actually round-trips through the preference store — the
// "two lists that must agree" rule, now that the accepted-values list is
// derived from the options table rather than hand-kept beside it.

// Per-key, because the rename put the old and new choices under different keys
// and the whole point of the migration is that they are read separately.
let prefs: Record<string, string> = {};

vi.mock("../prefsDb", () => ({
  readPref: vi.fn((key: string) => prefs[key] ?? null),
  writePref: vi.fn((key: string, value: string) => {
    prefs[key] = value;
    return true;
  }),
}));

vi.mock("expo-location", () => ({ Accuracy: { High: 4 } }));

const { FIX_RATE_OPTIONS, readFixRate, writeFixRate } = await import(
  "./recordingPreferences"
);

beforeEach(() => {
  prefs = {};
});

describe("fix rate preference", () => {
  it("defaults to the middle rate, not the finest one", () => {
    expect(readFixRate()).toBe("balanced");
  });

  it("falls back to the default when the stored value is unknown", () => {
    prefs.recordingFixRateV2 = "turbo";
    expect(readFixRate()).toBe("balanced");
  });

  it("round-trips every offered rate", () => {
    for (const rate of Object.keys(FIX_RATE_OPTIONS)) {
      writeFixRate(rate as keyof typeof FIX_RATE_OPTIONS);
      expect(readFixRate()).toBe(rate);
    }
  });

  // THE RENAME TRAP (2026-08-17): the names moved under the rates, and one name
  // — `balanced` — exists in both schemes meaning different things. A user who
  // chose "balanced" when it meant 10 s must keep 10 s, not silently inherit
  // the 30 s that now wears the name.
  describe("a choice made under the old names keeps its RATE", () => {
    const sameRate: Record<string, number> = {
      high: 3000,
      balanced: 10_000,
      battery: 30_000,
      maxSaver: 120_000,
    };

    for (const [legacy, timeInterval] of Object.entries(sameRate)) {
      it(`${legacy} still records every ${timeInterval / 1000}s`, () => {
        prefs.recordingFixRate = legacy;
        expect(FIX_RATE_OPTIONS[readFixRate()].timeInterval).toBe(timeInterval);
      });
    }

    it("prefers an explicit new choice over the old one", () => {
      prefs.recordingFixRate = "high";
      prefs.recordingFixRateV2 = "batterySaver";
      expect(readFixRate()).toBe("batterySaver");
    });

    it("does not re-translate its own value on the next read", () => {
      // `balanced` means one thing in the old scheme and another in the new, so
      // a migration that ran twice would walk the user down the list.
      writeFixRate("balanced");
      expect(readFixRate()).toBe("balanced");
      expect(FIX_RATE_OPTIONS[readFixRate()].timeInterval).toBe(30_000);
    });
  });

  it("asks for positions less often as the rate gets cheaper", () => {
    const intervals = Object.values(FIX_RATE_OPTIONS).map((o) => o.timeInterval);
    expect(intervals).toEqual([...intervals].sort((a, b) => Number(a) - Number(b)));
  });
});
