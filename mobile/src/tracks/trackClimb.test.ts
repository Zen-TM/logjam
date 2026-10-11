// A track's stored climb: what replaces it, what does not, and what the
// upgrade pass is allowed to cost.
//
// The DEM, the API and the stores are mocked, so this runs on the host. What
// is under test is the deciding: which figure wins, when nothing is read, and
// when a track is marked so it is not asked about again.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DemSamples, ElevationProfile } from "@logjam/shared";

const appState = { currentState: "active" as string };
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
  },
}));

/** What the saved terrain answers: a height per sample, from one source. */
let saved: { heightM: number | null; sourceId: string | null } = {
  heightM: null,
  sourceId: null,
};
const sampleElevationsOffline = vi.fn(
  async (positions: readonly unknown[]): Promise<DemSamples> => {
    // Rising 1 m a sample, so a covered line has a climb to report.
    const heights = positions.map((_, i) =>
      saved.heightM == null ? null : saved.heightM + i,
    );
    return {
      heights,
      levelled: heights,
      sourceIds: positions.map(() => saved.sourceId),
    };
  },
);
vi.mock("../offline/demLookup", () => ({
  sampleElevationsOffline: (positions: readonly unknown[]) =>
    sampleElevationsOffline(positions),
}));

const canRunNow = vi.fn(async (_job: string) => true);
vi.mock("../offline/networkPolicy", () => ({
  canRunNow: (job: string) => canRunNow(job),
}));

const apiFetch = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
vi.mock("../api/apiFetch", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const reclimbStandaloneMediaLocal = vi.fn(async (..._args: unknown[]) => {});
vi.mock("../sync/mediaUpload", () => ({
  reclimbStandaloneMediaLocal: (...args: unknown[]) =>
    reclimbStandaloneMediaLocal(...args),
}));

type Row = {
  id: string;
  state: string;
  elevationSource: string | null;
  mediaId: string | null;
};
let rows: Row[] = [];
const updateTrack = vi.fn(
  async (id: string, patch: { climb?: { elevationSource: string } }) => {
    const row = rows.find((r) => r.id === id);
    if (row && patch.climb) row.elevationSource = patch.climb.elevationSource;
  },
);
const markTrackClimbChecked = vi.fn(async (_id: string, _key: string) => {});
const listTracksDueClimbUpgrade = vi.fn(
  async (_finest: string, _key: string, limit: number) => rows.slice(0, limit),
);
const listTrackPoints = vi.fn(async (_id: string) =>
  [0, 1, 2].map((i) => ({
    lon: 150.4 + i * 0.01,
    lat: -33.5,
    altitudeM: 500,
    timestampMs: 1_700_000_000_000 + i * 60_000,
    segment: 0,
  })),
);
vi.mock("./tracksDb", () => ({
  getTrack: async (id: string) => rows.find((r) => r.id === id) ?? null,
  listTrackPoints: (id: string) => listTrackPoints(id),
  listTracksDueClimbUpgrade: (finest: string, key: string, limit: number) =>
    listTracksDueClimbUpgrade(finest, key, limit),
  markTrackClimbChecked: (id: string, key: string) =>
    markTrackClimbChecked(id, key),
  updateTrack: (id: string, patch: { climb?: { elevationSource: string } }) =>
    updateTrack(id, patch),
}));

const { setOfflineOnly } = await import("../offline/offlineOnlyMode");
const {
  climbFromSavedTerrain,
  climbSourcesKey,
  storeTrackClimb,
  upgradeTrackClimbs,
} = await import("./trackClimb");

const LINE: [number, number][][] = [
  [
    [150.4, -33.5],
    [150.42, -33.5],
  ],
];
const climb = (elevationSource: string) => ({
  elevationGainM: 41,
  elevationLossM: 38,
  elevationSource,
});
const track = (overrides: Partial<Row> = {}): Row => ({
  id: "track-1",
  state: "done",
  elevationSource: null,
  mediaId: "media-1",
  ...overrides,
});
/** What the API returns: a complete profile read from these sources. */
const apiProfile = (demSourceIds: string[]): ElevationProfile => ({
  samples: [
    { distanceM: 0, elevationM: 600 },
    { distanceM: 100, elevationM: 650 },
  ],
  gainM: 50,
  lossM: 0,
  minM: 600,
  maxM: 650,
  demSourceIds,
});

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  saved = { heightM: null, sourceId: null };
  appState.currentState = "active";
  setOfflineOnly(false);
  canRunNow.mockResolvedValue(true);
});

describe("the climb from the terrain saved on the phone", () => {
  it("is the saved terrain's when it covers the whole line", async () => {
    saved = { heightM: 600, sourceId: "nsw-5m" };
    const read = await climbFromSavedTerrain(LINE);
    expect(read?.elevationSource).toBe("nsw-5m");
    expect(read?.elevationGainM).toBeGreaterThan(0);
  });

  // Mutation: return the partial profile's figures and a track finished at
  // the edge of a saved area stores a climb summed over half its length.
  it("is nothing where the saved terrain has a hole, so GPS figures stay", async () => {
    saved = { heightM: 600, sourceId: "nsw-5m" };
    sampleElevationsOffline.mockImplementationOnce(async (positions) => {
      const heights = positions.map((_, i) => (i === 1 ? null : 600));
      return { heights, levelled: heights, sourceIds: [] };
    });
    expect(await climbFromSavedTerrain(LINE)).toBeNull();
  });

  it("is nothing rather than a throw when the terrain cannot be read", async () => {
    sampleElevationsOffline.mockRejectedValueOnce(new Error("disk"));
    expect(await climbFromSavedTerrain(LINE)).toBeNull();
  });
});

describe("storing a climb on a finished track", () => {
  it("replaces a coarser one and sends it to the account's copy", async () => {
    rows = [track({ elevationSource: "terrarium" })];
    expect(await storeTrackClimb("track-1", climb("nsw-5m"))).toBe(true);
    expect(updateTrack).toHaveBeenCalledWith("track-1", {
      climb: climb("nsw-5m"),
    });
    expect(reclimbStandaloneMediaLocal).toHaveBeenCalledWith(
      "media-1",
      climb("nsw-5m"),
    );
  });

  // Mutation: drop the `isFinerClimbSource` check and opening a track's sheet
  // out of range overwrites its 5 m climb with a 30 m one.
  it("keeps what is stored against the same source or a coarser one", async () => {
    rows = [track({ elevationSource: "nsw-5m" })];
    expect(await storeTrackClimb("track-1", climb("nsw-5m"))).toBe(false);
    expect(await storeTrackClimb("track-1", climb("terrarium"))).toBe(false);
    expect(await storeTrackClimb("track-1", null)).toBe(false);
    expect(updateTrack).not.toHaveBeenCalled();
    expect(reclimbStandaloneMediaLocal).not.toHaveBeenCalled();
  });

  it("leaves a live recording's figures to the recorder", async () => {
    rows = [track({ state: "recording" })];
    expect(await storeTrackClimb("track-1", climb("nsw-5m"))).toBe(false);
  });

  it("stores on the row alone when the track has no account copy", async () => {
    rows = [track({ mediaId: null })];
    expect(await storeTrackClimb("track-1", climb("terrarium"))).toBe(true);
    expect(reclimbStandaloneMediaLocal).not.toHaveBeenCalled();
  });
});

describe("the key a 'nothing finer' answer is filed under", () => {
  const nsw = { id: "nsw-5m", coverage: [141, -37.5, 153.7, -28] as const };
  const world = { id: "terrarium", coverage: null };
  const key = climbSourcesKey([nsw, world]);

  // Mutation: key on the ids alone and a source whose footprint grows is
  // never asked about again; key on nothing and no upgrade is ever noticed.
  it.each([
    ["a source is added", [{ id: "vic-10m", coverage: null }, nsw, world]],
    [
      "a source's footprint grows",
      [{ ...nsw, coverage: [140, -38, 154, -28] as const }, world],
    ],
    ["the precedence changes", [world, nsw]],
  ])("changes when %s", (_what, sources) => {
    expect(climbSourcesKey(sources)).not.toBe(key);
  });

  it("is the same for the same declaration, so nothing is asked twice", () => {
    expect(climbSourcesKey([{ ...nsw }, { ...world }])).toBe(key);
  });
});

describe("the upgrade pass", () => {
  // Mutation: drop any one of the three guards and its row reads the store.
  it.each([
    ["behind another app", () => (appState.currentState = "background")],
    ["in offline-only mode", () => setOfflineOnly(true)],
    [
      "on a connection sync may not use",
      () => canRunNow.mockResolvedValue(false),
    ],
  ])("reads nothing %s", async (_when, arrange) => {
    rows = [track()];
    arrange();
    expect(await upgradeTrackClimbs()).toBe(0);
    expect(listTracksDueClimbUpgrade).not.toHaveBeenCalled();
    expect(listTrackPoints).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("asks only for tracks short of the finest source, a few at a time", async () => {
    await upgradeTrackClimbs();
    const [finest, , limit] = listTracksDueClimbUpgrade.mock.calls[0]!;
    expect(finest).toBe("nsw-5m");
    expect(limit).toBeLessThanOrEqual(5);
  });

  it("takes the saved terrain's answer without a request", async () => {
    rows = [track()];
    saved = { heightM: 600, sourceId: "nsw-5m" };
    expect(await upgradeTrackClimbs()).toBe(1);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(rows[0]!.elevationSource).toBe("nsw-5m");
  });

  it("asks our API when the saved terrain cannot beat what is stored", async () => {
    rows = [track({ elevationSource: "terrarium" })];
    saved = { heightM: 600, sourceId: "terrarium" };
    apiFetch.mockResolvedValueOnce(apiProfile(["nsw-5m"]));
    expect(await upgradeTrackClimbs()).toBe(1);
    expect(apiFetch).toHaveBeenCalledWith(
      "/elevation/profile",
      expect.objectContaining({ method: "POST" }),
    );
    expect(updateTrack).toHaveBeenCalledWith("track-1", {
      climb: {
        elevationGainM: 50,
        elevationLossM: 0,
        elevationSource: "nsw-5m",
      },
    });
  });

  // A track outside the fine DEM's footprint stays on the coarse one for good.
  // Mutation: stop marking it and every sync cycle reads its whole series.
  it("marks a track the network had nothing finer for, and stores nothing", async () => {
    rows = [track({ elevationSource: "terrarium" })];
    apiFetch.mockResolvedValueOnce(apiProfile(["terrarium"]));
    expect(await upgradeTrackClimbs()).toBe(0);
    expect(updateTrack).not.toHaveBeenCalled();
    // Marked with the key the list was asked under, so the same sources never
    // select it again and a changed declaration does.
    const key = listTracksDueClimbUpgrade.mock.calls[0]![1];
    expect(key).toContain("nsw-5m");
    expect(markTrackClimbChecked).toHaveBeenCalledWith("track-1", key);
  });

  // Mutation: mark on a failed request and one bad link leaves every old
  // track on GPS figures until the DEM sources next change.
  it("stops at a failed request and leaves the rest unmarked", async () => {
    rows = [track(), track({ id: "track-2" })];
    apiFetch.mockRejectedValueOnce({ status: 503 });
    expect(await upgradeTrackClimbs()).toBe(0);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(markTrackClimbChecked).not.toHaveBeenCalled();
  });

  // The saved terrain can be coarser than what the API holds: its answer is
  // taken, and the track is still asked about, so it is not left on the
  // coarse figure.
  it("keeps the saved terrain's coarser answer when the request fails, unmarked", async () => {
    rows = [track()];
    saved = { heightM: 600, sourceId: "terrarium" };
    apiFetch.mockRejectedValueOnce({ status: 503 });
    expect(await upgradeTrackClimbs()).toBe(1);
    expect(rows[0]!.elevationSource).toBe("terrarium");
    expect(markTrackClimbChecked).not.toHaveBeenCalled();
  });

  // Mutation: treat a 400 like a dead link and one line the API refuses heads
  // the list and stops every later pass.
  it("marks a line the API refuses and goes on to the next track", async () => {
    rows = [track(), track({ id: "track-2" })];
    apiFetch.mockRejectedValueOnce({ status: 400 });
    apiFetch.mockResolvedValueOnce(apiProfile(["nsw-5m"]));
    expect(await upgradeTrackClimbs()).toBe(1);
    expect(markTrackClimbChecked).toHaveBeenCalledWith(
      "track-1",
      expect.any(String),
    );
    expect(rows[1]!.elevationSource).toBe("nsw-5m");
  });
});
