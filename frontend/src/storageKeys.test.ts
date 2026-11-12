import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reload = vi.hoisted(() => vi.fn());
vi.mock("./placeUtils", () => ({
  apiFetch: vi.fn(),
  recordConsent: vi.fn(),
  setSessionExpiredHandler: vi.fn(),
}));
vi.mock("./geoPdf/cache", () => ({ clearTileCache: vi.fn(async () => {}) }));

import { CLEARED_ON_SIGN_OUT } from "./signOutStores";
import { signOut } from "./useAuth";

// Every key Logjam Web writes to localStorage or sessionStorage is either
// removed at sign-out (CLEARED_ON_SIGN_OUT in signOutStores.ts, or by the
// module that owns it) or named here with the reason it stays. A key in none
// fails, so adding one forces the decision (frontend/AGENTS.md, Data).
//
// Mutation that turns it red: add `localStorage.setItem("logjam.newThing", "1")`
// to any source file (the scan finds an undecided key); drop "logjam.mapView"
// from CLEARED_ON_SIGN_OUT, or the clearKeptStores() call from endSession in
// useAuth.ts (the sign-out leaves the key behind); or make endSession clear a
// key listed in KEPT (it is no longer kept).
const CLEARED_BY_OWN_MODULE = [
  "logjam.tripDraft", // tripDraft.ts clearTripDraft
  "logjam.recentSearches", // recentSearches.ts clearRecentSearches
  "pendingFriendInvite", // pendingInvite.ts friendInvite.clear
  "pendingPlanInvite", // pendingInvite.ts planInvite.clear
];

const KEPT: Record<string, string> = {
  "logjam.signInArea":
    "which sign-in picture was shown last; read while nobody is signed in",
  "logjam.activeLayerId":
    "the basemap choice: a display preference of this device",
  "logjam.terrainLayers":
    "which terrain overlays are on: a device preference, names no place",
  "logjam.coverageCarrier":
    "the phone carrier picked for the coverage layer: a device preference",
  "logjam.showPlaces": "overlay toggle: a device preference",
  "logjam.showWays": "overlay toggle: a device preference",
  "logjam.showGauges": "overlay toggle: a device preference",
  "logjam.showMgaGrid": "overlay toggle: a device preference",
  "logjam.snapMode": "route drawing mode: a device preference",
  "logjam.placeSort":
    "sort order reorders and never hides: a device preference",
  "logjam.tripSort": "sort order reorders and never hides: a device preference",
  "logjam.logbookStatsRange":
    "a range label such as 'All time': a device preference",
  "logjam.weatherModel": "the forecast model picked: a device preference",
  "logjam.leaderboard.podiumDismissed":
    "per device by design, holds a season and no user",
  "logjam.geoPdf.canvasLimits.v1":
    "what this browser's canvas can hold: about the device, not the user",
};

const SRC = join(__dirname);
function sources(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|\.d\.ts$/.test(f))
    .map((f) => readFileSync(join(SRC, f), "utf8"));
}

function keysWritten(): Set<string> {
  const found = new Set<string>();
  const patterns = [
    // Every useStoredState key and key constant.
    /["'](logjam\.[A-Za-z0-9.]+)["']/g,
    // A key named at the storage call.
    /(?:session|local)Storage\.\w+Item\(\s*["']([^"']+)["']/g,
    // A key handed to the pending-invite factory.
    /pendingInvite\(\s*["']([^"']+)["']/g,
  ];
  for (const text of sources())
    for (const re of patterns)
      for (const m of text.matchAll(re)) found.add(m[1]);
  return found;
}

describe("every stored key is decided at sign-out", () => {
  const found = keysWritten();
  const decided = [
    ...CLEARED_ON_SIGN_OUT,
    ...CLEARED_BY_OWN_MODULE,
    ...Object.keys(KEPT),
  ];

  it("finds the keys the source writes", () => {
    // A regex that stops matching must not pass: 40 keys at the time of writing.
    expect(found.size).toBeGreaterThanOrEqual(35);
  });

  it("has no key that is neither cleared nor kept", () => {
    const undecided = [...found].filter((k) => !decided.includes(k)).sort();
    expect(
      undecided,
      `Stored but not decided: ${undecided.join(", ")}. Add each to CLEARED_ON_SIGN_OUT in src/signOutStores.ts if it holds what a user typed, picked or looked at, or to KEPT in src/storageKeys.test.ts with the reason it may outlive them.`,
    ).toEqual([]);
  });

  it("lists no key the source no longer writes, and none twice", () => {
    const stale = decided.filter((k) => !found.has(k));
    expect(
      stale,
      `Listed but never written: ${stale.join(", ")}. Remove them.`,
    ).toEqual([]);
    expect(new Set(decided).size).toBe(decided.length);
  });
});

describe("sign-out", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubEnv("VITE_AUTH_MODE", "fake");
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload, assign: vi.fn() },
    });
  });

  it("leaves none of the cleared keys behind in either store, and keeps the kept ones", async () => {
    const cleared = [...CLEARED_ON_SIGN_OUT, ...CLEARED_BY_OWN_MODULE];
    // A module's own key lives in one store only; the rest are written to both.
    for (const k of [...CLEARED_ON_SIGN_OUT, ...Object.keys(KEPT)]) {
      localStorage.setItem(k, "1");
      sessionStorage.setItem(k, "1");
    }
    for (const k of CLEARED_BY_OWN_MODULE)
      (k.startsWith("pending") ? sessionStorage : localStorage).setItem(k, "1");
    await signOut();
    const left = cleared.filter(
      (k) =>
        localStorage.getItem(k) !== null || sessionStorage.getItem(k) !== null,
    );
    expect(
      left,
      `Still in storage after sign-out: ${left.join(", ")}.`,
    ).toEqual([]);
    for (const k of Object.keys(KEPT))
      expect(localStorage.getItem(k), k).toBe("1");
  });
});
