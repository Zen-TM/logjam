import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharpenedOverlay } from "@logjam/shared";

// The phone's files.
const disk = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: async (uri: string) => {
    const text = disk.files.get(uri);
    if (text == null) throw new Error("no file");
    return text;
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    disk.files.set(uri, text);
  },
  makeDirectoryAsync: async () => {},
}));
// The real file reaches react-native (Flow syntax vitest cannot parse).
vi.mock("./localStores", () => ({
  SHARPENED_AREAS_DIR: "file:///docs/sharpened-areas/",
}));
vi.mock("@maplibre/maplibre-react-native", () => ({
  TransformRequestManager: {
    addUrlTransform: () => {},
    removeUrlTransform: () => {},
    clearUrlTransforms: () => {},
  },
}));

const FILE = "file:///docs/sharpened-areas/areas.json";

// A fresh JS context each time; the files stay.
const load = async () => ({
  ...(await import("./sharpenedAreaStore")),
  ...(await import("../map/sharpenedArchives")),
});

const area = (id: string): SharpenedOverlay => ({
  id,
  zmax: 17,
  tiles15: [100, 200, 101, 201],
  coverage: [150, -34, 150.1, -33.9],
  contours: true,
  credit: "Made-up credit",
  createdAt: "2026-10-01T00:00:00Z",
  heightsUrl: `https://bucket.example/${id}/h.pmtiles?X-Amz-Signature=h`,
  slopeUrl: `https://bucket.example/${id}/s.pmtiles?X-Amz-Signature=s`,
  contoursUrl: `https://bucket.example/${id}/c.pmtiles?X-Amz-Signature=c`,
});

beforeEach(() => {
  vi.resetModules();
  disk.files.clear();
});

describe("sharpenedAreaStore", () => {
  // Red if a URL is kept: a presigned URL is a bearer credential.
  it("keeps each area without its URLs, and reads it back in the next run", async () => {
    const first = await load();
    await first.rememberSharpenedAreas(
      [area("a1")],
      first.sharpenedAreasEpoch(),
    );
    expect(disk.files.get(FILE)).not.toContain("X-Amz");
    vi.resetModules();
    const next = await load();
    const [kept] = await next.savedSharpenedAreas();
    expect(kept).toEqual({
      id: "a1",
      zmax: 17,
      tiles15: [100, 200, 101, 201],
      coverage: [150, -34, 150.1, -33.9],
      contours: true,
      credit: "Made-up credit",
      createdAt: "2026-10-01T00:00:00Z",
    });
  });

  // Red if the epoch isn't checked: a list in flight at sign-out would put
  // the departing account's areas back on disk after the wipe.
  it("never keeps a list asked for before the sign-out wipe", async () => {
    const {
      inAreasEpoch,
      rememberSharpenedAreas,
      savedSharpenedAreas,
      stopSharpenedAreasForWipe,
      forgetSharpenedAreas,
    } = await load();
    let land!: (list: object) => void;
    const answer = inAreasEpoch(() => new Promise<object>((r) => (land = r)));
    stopSharpenedAreasForWipe();
    await forgetSharpenedAreas();
    land({});
    await rememberSharpenedAreas([area("a1")], (await answer).areasEpoch);
    expect(disk.files.has(FILE)).toBe(false);
    expect(await savedSharpenedAreas()).toEqual([]);
  });

  // Red if the queued write doesn't check the epoch again: the wipe lands
  // between the list arriving and the file being written.
  it("drops a write still queued when the sign-out wipe runs", async () => {
    const {
      rememberSharpenedAreas,
      sharpenedAreasEpoch,
      stopSharpenedAreasForWipe,
      forgetSharpenedAreas,
    } = await load();
    void rememberSharpenedAreas([area("a1")], sharpenedAreasEpoch());
    stopSharpenedAreasForWipe();
    await forgetSharpenedAreas();
    expect(disk.files.has(FILE)).toBe(false);
  });

  // Red if the wipe leaves the areas in memory for the next account.
  it("forgets the areas in memory at the wipe", async () => {
    const {
      rememberSharpenedAreas,
      savedSharpenedAreas,
      sharpenedAreasEpoch,
      stopSharpenedAreasForWipe,
      forgetSharpenedAreas,
    } = await load();
    await rememberSharpenedAreas([area("a1")], sharpenedAreasEpoch());
    stopSharpenedAreasForWipe();
    await forgetSharpenedAreas();
    expect(await savedSharpenedAreas()).toEqual([]);
  });

  // Red if a list kept from elsewhere (the save screen's) doesn't reach the
  // mounted map: an area new since the map loaded its own list would be cut
  // into the save but never drawn or read offline.
  it("tells the map when a newer list is kept, and when the wipe forgets it", async () => {
    const {
      rememberSharpenedAreas,
      savedSharpenedAreas,
      sharpenedAreasEpoch,
      stopSharpenedAreasForWipe,
      forgetSharpenedAreas,
      subscribeSharpenedAreas,
    } = await load();
    await rememberSharpenedAreas([area("a1")], sharpenedAreasEpoch());
    const seen: string[][] = [];
    const stop = subscribeSharpenedAreas(async () => {
      seen.push((await savedSharpenedAreas()).map((a) => a.id));
    });
    await rememberSharpenedAreas(
      [area("a1"), area("a2")],
      sharpenedAreasEpoch(),
    );
    stopSharpenedAreasForWipe();
    await forgetSharpenedAreas();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([["a1", "a2"], []]);
    stop();
  });

  // Red if a bad file doesn't read as empty: a file this build didn't write
  // must not name areas.
  it("reads no area from a file it can't use", async () => {
    disk.files.set(FILE, JSON.stringify([{ id: "a1", zmax: 18 }, "x"]));
    const { savedSharpenedAreas } = await load();
    expect(await savedSharpenedAreas()).toEqual([]);
  });
});
