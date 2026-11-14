import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_REGION_IDS,
  indexPlaceRegistry,
  NSW_REGION,
  searchPlaces,
  type LonLatBox,
  type PlaceRegistryFile,
  type Region,
} from "@logjam/shared";
import { gzipSync, strFromU8, strToU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

// When the place registry is fetched, on what connection, and that a bad
// download never replaces a good file (ADR 0034). The filesystem, the CDN and
// NetInfo are fakes; the decisions and the swap are the real module.

const DIR = "file:///docs/place-registry/";
const CDN = "https://cdn.test";
const POINTER_URL = `${CDN}/master/places/v1/latest.json`;
const NSW = DEFAULT_REGION_IDS[0];

// A second region with a registry of its own, and the map over each.
const OTHER = vi.hoisted(() => ({
  id: "other",
  placeSearch: "master/places/other/v1/",
  // A square a long way from NSW.
  borders: [
    [
      [10, 10],
      [11, 10],
      [11, 11],
      [10, 11],
    ],
  ],
}));
vi.mock("@logjam/shared", async (original) => {
  const real = await original<typeof import("@logjam/shared")>();
  const other = { ...real.NSW_REGION, ...OTHER } as unknown as Region;
  // And one that declares no registry, as a simulated region does today.
  const bare = { ...real.NSW_REGION, id: "bare", placeSearch: null } as Region;
  return { ...real, REGIONS: [...real.REGIONS, other, bare] };
});
const [OTHER_LON, OTHER_LAT] = [10.5, 10.5];
const around = (lon: number, lat: number): LonLatBox => ({
  west: lon - 0.05,
  south: lat - 0.05,
  east: lon + 0.05,
  north: lat + 0.05,
});
const OVER_NSW = around(...NSW_REGION.view.center);
const OVER_OTHER = around(OTHER_LON, OTHER_LAT);
const OTHER_POINTER_URL = `${CDN}/${OTHER.placeSearch}latest.json`;
/** The regions the user chose, as `regionsPreference` keeps them. */
const chosen = { ids: [NSW] };

const files = new Map<string, Uint8Array | string>();
/** What lands on the phone for a URL: the pointer as JSON, a data file as
 *  the platform saved it (plain JSON, after its Content-Encoding: gzip). */
const served = new Map<string, unknown>();
const prefs = new Map<string, string>();
/** Every file read whole into memory, as "text" or "bytes", and its URI. */
const reads: string[] = [];
const artifacts = {
  kinds: [] as string[],
  bbox: null as [number, number, number, number] | null,
};
const network = { expensive: false, connected: true };
const disk = { free: 1e12 };
/** A filesystem call to fail once, by name. */
const failing = new Set<string>();
/** Reads held until their promise settles, by URI. */
const held = new Map<string, Promise<void>>();
const offlineOnly = { on: false };
/** A download that waits for this promise before it answers. */
const downloadGate = { current: Promise.resolve() };

const download = vi.hoisted(() => vi.fn());
vi.mock("../api/presignedTransfer", () => ({
  downloadFromPresignedUrl: download,
}));
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: async () => {},
  // A folder goes with what is in it, named with or without its slash.
  deleteAsync: async (uri: string) => {
    const folder = uri.endsWith("/") ? uri : `${uri}/`;
    for (const key of [...files.keys()]) {
      if (key === uri || key.startsWith(folder)) files.delete(key);
    }
  },
  getFreeDiskStorageAsync: async () => disk.free,
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
    if (failing.delete("move")) throw new Error("move failed");
    files.set(to, files.get(from) as Uint8Array);
    files.delete(from);
  },
  writeAsStringAsync: async (uri: string, text: string) => {
    files.set(uri, text);
  },
  getInfoAsync: async (uri: string) => {
    const body = files.get(uri);
    return body instanceof Uint8Array
      ? { exists: true, size: body.length }
      : { exists: false };
  },
  EncodingType: { Base64: "base64" },
  readAsStringAsync: async (
    uri: string,
    options: { position: number; length: number },
  ) => {
    const body = files.get(uri);
    // As the real API does for a missing file.
    if (!(body instanceof Uint8Array)) throw new Error(`no file ${uri}`);
    return Buffer.from(
      body.slice(options.position, options.position + options.length),
    ).toString("base64");
  },
  readDirectoryAsync: async (dir: string) => {
    if (failing.delete("readdir")) throw new Error("readdir failed");
    // The names directly in `dir`: a folder's files are listed as the folder.
    const names = [...files.keys()]
      .filter((key) => key.startsWith(dir))
      .map((key) => key.slice(dir.length).split("/")[0]);
    return [...new Set(names)];
  },
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(private uri: string) {}
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return (files.get(this.uri) as Uint8Array).length;
    }
    textSync() {
      return files.get(this.uri) as string;
    }
    async text() {
      reads.push(`text ${this.uri}`);
      if (failing.delete("read")) throw new Error("read failed");
      await held.get(this.uri);
      return strFromU8(await this.read());
    }
    async bytes() {
      reads.push(`bytes ${this.uri}`);
      return this.read();
    }
    private async read() {
      const body = files.get(this.uri);
      if (!(body instanceof Uint8Array)) throw new Error("no such file");
      return body;
    }
  },
}));
vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
// React Native 0.88 removed InteractionManager; the module waits on the
// runtime's requestIdleCallback instead. jsdom has none, so run it inline.
const idleOptions: (IdleRequestOptions | undefined)[] = [];
globalThis.requestIdleCallback = (run, options) => {
  idleOptions.push(options);
  run({ didTimeout: false, timeRemaining: () => 0 });
  return 0;
};
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    refresh: async () => ({
      isConnected: network.connected,
      details: { isConnectionExpensive: network.expensive },
    }),
  },
}));
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => prefs.get(key) ?? null,
  writePref: (key: string, value: string) => {
    prefs.set(key, value);
    return true;
  },
}));
vi.mock("./localStores", () => ({ PLACE_REGISTRY_DIR: DIR }));
vi.mock("./offlineOnlyMode", () => ({ isOfflineOnly: () => offlineOnly.on }));
vi.mock("../config", () => ({ config: { topoCdnBaseUrl: CDN } }));
vi.mock("../map/connectivity", () => ({ subscribeReconnect: () => () => {} }));
vi.mock("./registryDb", () => ({
  listArtifacts: async () =>
    artifacts.kinds.map((kind) => ({ kind, bbox: artifacts.bbox })),
}));
vi.mock("../regionsPreference", () => ({ readRegions: () => chosen.ids }));

const fetchMock = vi.fn(async (url: string) => {
  const body = served.get(url);
  return { ok: body !== undefined, json: async () => body };
});
vi.stubGlobal("fetch", fetchMock);

function build(version: string, names = ["Mount Solitary"], format = 1) {
  const path = `places-${version}.json`;
  const plain = strToU8(
    JSON.stringify({
      format,
      version,
      attribution: "© OpenStreetMap contributors",
      licence: "ODbL-1.0",
      coordScale: 1e5,
      kinds: ["natural=peak"],
      names,
      kind: names.map(() => 0),
      lon: names.map(() => 15_030_000),
      lat: names.map(() => -3_370_000),
      near: names.map(() => -1),
      alternates: [],
    }),
  );
  const gzipped = gzipSync(plain);
  // `bytes` is what the CDN sends: the gzipped size.
  return {
    pointer: { format: 1, version, path, bytes: gzipped.length },
    plain,
    gzipped,
  };
}

/** Put a build on the CDN as the current one. */
function publish(
  built: ReturnType<typeof build>,
  data: Uint8Array = built.plain,
) {
  served.set(POINTER_URL, built.pointer);
  served.set(`${CDN}/master/places/v1/${built.pointer.path}`, data);
}

/** The same for the other region, under its own prefix. */
function publishOther(built: ReturnType<typeof build>) {
  served.set(OTHER_POINTER_URL, built.pointer);
  served.set(`${CDN}/${OTHER.placeSearch}${built.pointer.path}`, built.plain);
}

/** Put the other region's build on the phone, in its own folder. */
function holdOtherOnPhone(built: ReturnType<typeof build>) {
  files.set(`${DIR}other/pointer.json`, JSON.stringify(built.pointer));
  files.set(`${DIR}other/${built.pointer.path}`, built.plain);
}

/** Put a build on the phone, as an earlier session left it. */
function holdOnPhone(
  built: ReturnType<typeof build>,
  data: Uint8Array = built.plain,
) {
  files.set(`${DIR}pointer.json`, JSON.stringify(built.pointer));
  files.set(`${DIR}${built.pointer.path}`, data);
}

function half(data: Uint8Array): Uint8Array {
  return data.slice(0, Math.floor(data.length / 2));
}

type Registry = typeof import("./placeRegistry");
async function load(): Promise<Registry> {
  vi.resetModules();
  return import("./placeRegistry");
}

beforeEach(() => {
  files.clear();
  served.clear();
  prefs.clear();
  reads.length = 0;
  artifacts.kinds = [];
  artifacts.bbox = null;
  chosen.ids = [NSW];
  network.expensive = false;
  network.connected = true;
  offlineOnly.on = false;
  disk.free = 1e12;
  failing.clear();
  held.clear();
  fetchMock.mockClear();
  downloadGate.current = Promise.resolve();
  download.mockReset().mockImplementation(async (url: string, to: string) => {
    await downloadGate.current;
    const body = served.get(url);
    if (!(body instanceof Uint8Array)) return { status: 404 };
    files.set(to, body);
    return { status: 200 };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the first download", () => {
  // Mutation: return before the fetch in `placeRegistryWithRegion`, or add
  // headers (a token, an account id) or another URL to either request.
  it("comes with the first region download, from the CDN with nothing else sent", async () => {
    const built = build("2026-10-15");
    publish(built);
    const registry = await load();
    registry.placeRegistryWithRegion(false, OVER_NSW);
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
    expect(fetchMock.mock.calls).toEqual([
      [POINTER_URL, { signal: expect.any(AbortSignal) }],
    ]);
    expect(download.mock.calls).toEqual([
      [`${CDN}/master/places/v1/${built.pointer.path}`, `${DIR}download.tmp`],
    ]);
  });

  // Mutation: drop the `timeout` option in `installBuild`; a busy JS thread
  // then defers the install for as long as it stays busy.
  it("waits for an idle frame, but not forever", async () => {
    idleOptions.length = 0;
    publish(build("2026-10-15"));
    const registry = await load();
    registry.placeRegistryWithRegion(false, OVER_NSW);
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
    expect(idleOptions).toEqual([{ timeout: expect.any(Number) }]);
  });

  // Mutation: ignore `allowMetered` in `placeRegistryWithRegion`.
  it("goes on mobile data when the user allowed it for the maps", async () => {
    network.expensive = true;
    publish(build("2026-10-15"));
    const registry = await load();
    registry.placeRegistryWithRegion(true, OVER_NSW);
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
  });
});

describe("a phone that held a region before Logjam GPS had the file", () => {
  // Mutation: drop `adoptForSavedRegions` from the start-up check.
  it("counts as having asked, and fetches it at app start", async () => {
    artifacts.kinds = ["basemap-region", "dem-region"];
    publish(build("2026-10-15"));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
    expect(prefs.get("placeRegistryWanted")).toBe("on");
  });

  // A phone that used Remove, when the file could be removed, still holds
  // "off". It is public data and cannot be removed now, so it is fetched again.
  // Mutation: restore `!== null` in `adoptForSavedRegions` (the "off" phone
  // with a region would be left without the file).
  it('takes a legacy "off" phone with a saved region back to "on" and fetches', async () => {
    prefs.set("placeRegistryWanted", "off");
    artifacts.kinds = ["basemap-region"];
    publish(build("2026-10-15"));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
    expect(prefs.get("placeRegistryWanted")).toBe("on");
  });

  // Mutation: adopt without looking for a region.
  it('leaves a legacy "off" phone with no saved region alone', async () => {
    prefs.set("placeRegistryWanted", "off");
    artifacts.kinds = ["topo-overlay"];
    publish(build("2026-10-15"));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prefs.get("placeRegistryWanted")).toBe("off");
  });

  // Mutation: restore the `=== "off"` return in `placeRegistryWithRegion`.
  it('fetches for a region download on a legacy "off" phone, and turns it "on"', async () => {
    prefs.set("placeRegistryWanted", "off");
    publish(build("2026-10-15"));
    const registry = await load();
    registry.placeRegistryWithRegion(false, OVER_NSW);
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
    expect(prefs.get("placeRegistryWanted")).toBe("on");
  });

  it("fetches nothing for a phone with no saved region", async () => {
    artifacts.kinds = ["topo-overlay"];
    publish(build("2026-10-15"));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prefs.get("placeRegistryWanted")).toBeUndefined();
  });
});

describe("the saved file", () => {
  // Mutation: gunzip every file, or read it as bytes.
  it("is read as the plain JSON the platform saved", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    await registry.fetchPlaceRegistry(NSW, { allowMetered: true });
    await registry.loadPlaceIndex(NSW);
    expect(reads).toEqual([
      `text ${DIR}download.tmp`,
      `text ${DIR}places-2026-10-15.json`,
    ]);
  });

  // Mutation: drop the gzip fallback.
  it("is gunzipped when a stack saved it as it came", async () => {
    const built = build("2026-10-15", ["Wollangambe"]);
    publish(built, built.gzipped);
    const registry = await load();
    expect(await registry.fetchPlaceRegistry(NSW, { allowMetered: true })).toBe(
      "updated",
    );
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Wollangambe",
    ]);
  });
});

describe("the refresh", () => {
  // Mutation: drop the `!== "on"` check in `refreshPlaceRegistry`.
  it("fetches nothing for a phone that never asked for the file", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mutation: drop the `canRunNow("placeNames")` check from the refresh.
  it("waits for Wi-Fi by default", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    network.expensive = true;
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();

    network.expensive = false;
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect(files.has(`${DIR}places-2026-10-15.json`)).toBe(true);
    expect(files.has(`${DIR}places-2026-09-15.json`)).toBe(false);
  });

  it("takes mobile data once the user allows it", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    prefs.set("meteredPlaceNames", "on");
    publish(build("2026-10-15"));
    network.expensive = true;
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
  });

  // Mutation: drop the `isOfflineOnly()` check.
  it("does nothing in offline-only mode", async () => {
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    offlineOnly.on = true;
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("offline-only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads nothing when the phone has the current build", async () => {
    const current = build("2026-10-15");
    holdOnPhone(current);
    prefs.set("placeRegistryWanted", "on");
    publish(current);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("current");
    expect(download).not.toHaveBeenCalled();
  });
});

describe("a bad download never replaces a good file", () => {
  // Mutation: move the download into place before `readFile` checks it.
  it.each([
    ["is not JSON", strToU8("<html>503</html>")],
    ["is cut short", half(build("2026-10-15").plain)],
    ["is a gzip cut short", half(build("2026-10-15").gzipped)],
    ["is another build than its pointer says", build("2026-11-15").plain],
  ])("keeps the old build when the new one %s", async (_case, data) => {
    const good = build("2026-09-15", ["Mount Solitary", "Narrow Neck"]);
    holdOnPhone(good);
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"), data);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("failed");
    expect([...files.keys()].sort()).toEqual(
      [`${DIR}places-2026-09-15.json`, `${DIR}pointer.json`].sort(),
    );
    const index = await registry.loadPlaceIndex(NSW);
    expect(index?.names).toEqual(["Mount Solitary", "Narrow Neck"]);
  });

  // Mutation: drop the size check before gunzipping.
  it("never gunzips a gzip download that is not the size its pointer says", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"), half(build("2026-10-15").gzipped));
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("failed");
    expect(reads).not.toContain(`bytes ${DIR}download.tmp`);
  });

  // Mutation: accept a pointer of any format.
  it("keeps the old build when the pointer is not one this build reads", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    served.set(POINTER_URL, {
      format: 2,
      version: "x",
      path: "../x",
      bytes: 1,
    });
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("failed");
    expect(registry.hasPlaceRegistry(NSW)).toBe(true);
  });
});

describe("a failed swap", () => {
  // Mutation: write the pointer before moving the data file into place.
  it("leaves the old build for the next session", async () => {
    holdOnPhone(build("2026-09-15", ["Narrow Neck"]));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    failing.add("move");
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("failed");
    const next = await load();
    expect((await next.loadPlaceIndex(NSW))?.names).toEqual(["Narrow Neck"]);
  });
});

describe("the sweep after a swap", () => {
  // Mutation: let a failing sweep throw out of `installBuild`.
  it("is best effort: the install still counts", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15", ["Wollangambe"]));
    failing.add("readdir");
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Wollangambe",
    ]);
  });
});

describe("free space", () => {
  // The file is saved decompressed, so it needs more than the pointer's bytes.
  const needs = (built: ReturnType<typeof build>) => built.plain.length;

  // Mutation: drop the `assertSpaceFor` call.
  it("refuses a download the user asked for, by rejecting", async () => {
    const built = build("2026-10-15");
    publish(built);
    disk.free = needs(built);
    const registry = await load();
    await expect(
      registry.fetchPlaceRegistry(NSW, { allowMetered: true }),
    ).rejects.toThrow(/^Needs about/);
    expect(download).not.toHaveBeenCalled();
  });

  // Mutation: let a joining refresh await the refused run's rejection.
  it('gives a refresh that joins a refused download of the user\'s "skipped"', async () => {
    const built = build("2026-10-15");
    publish(built);
    disk.free = needs(built);
    const registry = await load();
    const asked = registry
      .fetchPlaceRegistry(NSW, { allowMetered: true })
      .catch((err: unknown) => err);
    const refresh = registry.refreshPlaceRegistry(NSW);
    expect(await refresh).toBe("skipped");
    expect(await asked).toBeInstanceOf(Error);
  });

  // Mutation: drop the `hasSpaceFor` call.
  it("skips a refresh that would not fit", async () => {
    const built = build("2026-10-15");
    prefs.set("placeRegistryWanted", "on");
    publish(built);
    disk.free = needs(built);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("skipped");
    expect(download).not.toHaveBeenCalled();
  });
});

describe("one fetch at a time", () => {
  // Mutation: hand every caller the run in flight's outcome.
  it("runs again for a caller allowed on mobile data when the run in flight was not", async () => {
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    network.expensive = true;
    const registry = await load();
    const refresh = registry.refreshPlaceRegistry(NSW);
    const asked = registry.fetchPlaceRegistry(NSW, { allowMetered: true });
    expect(await refresh).toBe("skipped");
    expect(await asked).toBe("updated");
  });
});

describe("a load that fails", () => {
  // Mutation: forget the file on any error.
  it("keeps the file after a read that failed for another reason", async () => {
    holdOnPhone(build("2026-09-15", ["Narrow Neck"]));
    failing.add("read");
    const registry = await load();
    expect(await registry.loadPlaceIndex(NSW)).toBeNull();
    expect(registry.hasPlaceRegistry(NSW)).toBe(true);
    // Mutation: publish nothing when the file is kept (the search box would
    // show "Loading place names…" for good), or never clear it.
    expect(registry.placeRegistryStatus(NSW).loadFailed).toBe(true);
    const retried = registry.loadPlaceIndex(NSW);
    expect(registry.placeRegistryStatus(NSW).loadFailed).toBe(false);
    expect((await retried)?.names).toEqual(["Narrow Neck"]);
  });

  // Mutation: throw a plain Error for a missing file in `readFile`.
  it("forgets a pointer whose data file is gone, and the next refresh fetches it", async () => {
    const built = build("2026-10-15", ["Narrow Neck"]);
    holdOnPhone(built);
    files.delete(`${DIR}${built.pointer.path}`);
    prefs.set("placeRegistryWanted", "on");
    publish(built);
    const registry = await load();
    expect(await registry.loadPlaceIndex(NSW)).toBeNull();
    expect(registry.hasPlaceRegistry(NSW)).toBe(false);
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Narrow Neck",
    ]);
  });

  // Mutation: keep a file that does not match its pointer.
  it("forgets a file that is not the build its pointer names", async () => {
    const built = build("2026-09-15");
    holdOnPhone(built, half(built.plain));
    const registry = await load();
    expect(await registry.loadPlaceIndex(NSW)).toBeNull();
    expect(registry.hasPlaceRegistry(NSW)).toBe(false);
    expect(files.has(`${DIR}pointer.json`)).toBe(false);
  });

  // Mutation: drop the `UNREADABLE_PREF_KEY` check in `runFetch`, or key it
  // by the version rather than the path.
  it("never fetches again a build that would not index, but fetches its fixed rebuild", async () => {
    const unindexable = build("2026-10-15", ["Narrow Neck"], 2);
    prefs.set("placeRegistryWanted", "on");
    publish(unindexable);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect(await registry.loadPlaceIndex(NSW)).toBeNull();
    expect(registry.hasPlaceRegistry(NSW)).toBe(false);
    // Mutation: drop the data file's delete in `buildIndex`.
    expect(files.has(`${DIR}${unindexable.pointer.path}`)).toBe(false);
    download.mockClear();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("unreadable");
    expect(download).not.toHaveBeenCalled();
    // Rebuilt from the same extract: same version, a new content hash.
    const fixed = build("2026-10-15", ["Narrow Neck"]);
    fixed.pointer.path = "places-2026-10-15-fixed.json";
    publish(fixed);
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Narrow Neck",
    ]);
  });
});

describe("the index in memory", () => {
  // Mutation: share one load across builds (`loading ??=`).
  it("is never the replaced build's, when a refresh lands mid-load", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15", ["Wollangambe"]));
    let release = () => {};
    held.set(
      `${DIR}places-2026-09-15.json`,
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const registry = await load();
    const old = registry.loadPlaceIndex(NSW);
    await registry.refreshPlaceRegistry(NSW);
    const fresh = registry.loadPlaceIndex(NSW);
    release();
    expect(await old).toBeNull();
    expect((await fresh)?.names).toEqual(["Wollangambe"]);
    expect(registry.placeIndex(NSW)?.names).toEqual(["Wollangambe"]);
  });

  it("is dropped by a refresh, and the next search builds the new one", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15", ["Wollangambe"]));
    const registry = await load();
    expect(registry.placeIndex(NSW)).toBeNull();
    await registry.loadPlaceIndex(NSW);
    await registry.refreshPlaceRegistry(NSW);
    expect(registry.placeIndex(NSW)).toBeNull();
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Wollangambe",
    ]);
  });

  // Mutation: build it with `indexPlaceRegistry`, in one block.
  it("is built a slice at a time, letting timers run between slices", async () => {
    const names = Array.from({ length: 60_000 }, (_, at) => `Peak ${at}`);
    holdOnPhone(build("2026-10-15", names));
    const registry = await load();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const index = await registry.loadPlaceIndex(NSW);
    expect(index?.names).toHaveLength(60_000);
    expect(
      timer.mock.calls.filter(([, ms]) => ms === 0).length,
    ).toBeGreaterThan(1);
    timer.mockRestore();
  });

  // Mutation: keep an index built in the refresh's parse step.
  it("is not built by a refresh nobody searched after", async () => {
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    const registry = await load();
    await registry.refreshPlaceRegistry(NSW);
    expect(registry.placeIndex(NSW)).toBeNull();
  });
});

describe("one ranking, on the phone and on the API", () => {
  // The builder's fixture and pointer, as the API's own tests read them.
  const FIXTURES = join(__dirname, "../../../shared/src/__fixtures__");
  const fixture = JSON.parse(
    readFileSync(join(FIXTURES, "place-registry.json"), "utf8"),
  ) as PlaceRegistryFile;
  const pointer = JSON.parse(
    readFileSync(join(FIXTURES, "place-registry-pointer.json"), "utf8"),
  ) as { path: string };

  // Mutation: re-rank or filter what `loadPlaceIndex` hands the search box,
  // or build its index any other way than `indexPlaceRegistryInSlices`.
  it.each(["castle", "katoomba falls", "lookout"])(
    "answers %s exactly as searchPlaces does over the same file",
    async (query) => {
      served.set(POINTER_URL, pointer);
      served.set(
        `${CDN}/master/places/v1/${pointer.path}`,
        strToU8(JSON.stringify(fixture)),
      );
      const registry = await load();
      expect(
        await registry.fetchPlaceRegistry(NSW, { allowMetered: true }),
      ).toBe("updated");
      const index = await registry.loadPlaceIndex(NSW);
      if (!index) throw new Error("the fixture did not load");
      const expected = searchPlaces(indexPlaceRegistry(fixture), query, 8);
      expect(expected.length).toBeGreaterThan(0);
      expect(searchPlaces(index, query, 8)).toEqual(expected);
    },
  );
});

describe("one copy for each region", () => {
  // Mutation: save every region's copy in PLACE_REGISTRY_DIR itself, and the
  // other region's files land beside NSW's, and its sweep deletes them; drop
  // the folder test from the sweep in `installBuild`, and NSW's sweep deletes
  // the other region's folder.
  it("keeps each region's copy apart", async () => {
    publish(build("2026-10-15", ["Wollangambe"]));
    publishOther(build("2026-10-15", ["Makarora"]));
    chosen.ids = [NSW, OTHER.id];
    prefs.set("placeRegistryWanted", "on");
    const registry = await load();
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect(await registry.refreshPlaceRegistry(OTHER.id)).toBe("updated");
    expect([...files.keys()].sort()).toEqual([
      `${DIR}other/places-2026-10-15.json`,
      `${DIR}other/pointer.json`,
      `${DIR}places-2026-10-15.json`,
      `${DIR}pointer.json`,
    ]);

    // A new NSW build sweeps NSW's folder, and only that.
    publish(build("2026-11-15", ["Wollangambe"]));
    expect(await registry.refreshPlaceRegistry(NSW)).toBe("updated");
    expect(files.has(`${DIR}places-2026-11-15.json`)).toBe(true);
    expect(files.has(`${DIR}places-2026-10-15.json`)).toBe(false);
    expect(files.has(`${DIR}other/pointer.json`)).toBe(true);
    expect(files.has(`${DIR}other/places-2026-10-15.json`)).toBe(true);

    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Wollangambe",
    ]);
    expect((await registry.loadPlaceIndex(OTHER.id))?.names).toEqual([
      "Makarora",
    ]);
    expect(registry.placeIndex(OTHER.id)?.names).toEqual(["Makarora"]);
  });

  // Mutation: read `PLACE_REGISTRY_PREFIX`'s pointer for every region, and the
  // other region's copy is NSW's file.
  it("fetches each region's pointer and file from the prefix it declares", async () => {
    publish(build("2026-10-15"));
    publishOther(build("2026-10-16", ["Makarora"]));
    const registry = await load();
    await registry.fetchPlaceRegistry(OTHER.id, { allowMetered: true });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      OTHER_POINTER_URL,
    ]);
    expect(download.mock.calls.map(([url]) => url)).toEqual([
      `${CDN}/${OTHER.placeSearch}places-2026-10-16.json`,
    ]);
  });

  // Mutation: look the region up with `REGIONS.find` on its id in the copy's
  // lookups, without `regionWithRegistry`, or answer an id it does not know
  // with NSW's copy.
  it("has no copy for a region that is unknown or declares no registry", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    for (const id of ["nowhere", "bare", null]) {
      expect(registry.hasPlaceRegistry(id)).toBe(false);
      expect(registry.placeRegistryStatus(id)).toEqual({
        stored: null,
        loadFailed: false,
      });
      expect(await registry.loadPlaceIndex(id)).toBeNull();
    }
    expect(await registry.fetchPlaceRegistry("bare", {})).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mutation: key the unreadable build by one preference for every region,
  // and a build that would not index in one region stops another region's
  // build of the same name from being fetched.
  it("remembers an unreadable build for its own region only", async () => {
    publishOther(build("2026-10-15", ["Makarora"], 2));
    publish(build("2026-10-15", ["Wollangambe"]));
    const registry = await load();
    expect(
      await registry.fetchPlaceRegistry(OTHER.id, { allowMetered: true }),
    ).toBe("updated");
    expect(await registry.loadPlaceIndex(OTHER.id)).toBeNull();
    expect(
      await registry.fetchPlaceRegistry(OTHER.id, { allowMetered: true }),
    ).toBe("unreadable");
    expect(await registry.fetchPlaceRegistry(NSW, { allowMetered: true })).toBe(
      "updated",
    );
  });
});

describe("the regions a phone fetches for", () => {
  const SEA = around(156, -33);

  // Mutation: drop `regionsTouching(box, REGIONS)` from `placeRegistryWithRegion`,
  // and a save in another region brings only NSW's names.
  it("includes each region the first saved box touches", async () => {
    publish(build("2026-10-15"));
    publishOther(build("2026-10-15", ["Makarora"]));
    const registry = await load();
    registry.placeRegistryWithRegion(false, OVER_OTHER);
    await vi.waitFor(() =>
      expect(registry.hasPlaceRegistry(OTHER.id)).toBe(true),
    );
    // And the one the user chose, which the box does not touch.
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
  });

  // Mutation: drop `regionsOf(readRegions(), REGIONS)` from
  // `placeRegistryWithRegion`, and a save over the sea brings nothing.
  it("includes each region the user chose, whatever the box touches", async () => {
    publish(build("2026-10-15"));
    publishOther(build("2026-10-15", ["Makarora"]));
    chosen.ids = [OTHER.id];
    const registry = await load();
    registry.placeRegistryWithRegion(false, SEA);
    await vi.waitFor(() =>
      expect(registry.hasPlaceRegistry(OTHER.id)).toBe(true),
    );
    expect(registry.hasPlaceRegistry(NSW)).toBe(false);
  });

  // Mutation: drop the `hasPlaceRegistry` skip, and a second save downloads
  // the files again.
  it("fetches nothing for a region it already holds", async () => {
    const held = build("2026-10-15");
    holdOnPhone(held);
    publish(held);
    const registry = await load();
    registry.placeRegistryWithRegion(false, OVER_NSW);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mutation: drop the saved-map part of `regionsToKeep`, and a phone that
  // saved a map over the other region never refreshes its names.
  it("keeps current a region a saved map touches", async () => {
    artifacts.kinds = ["basemap-region"];
    artifacts.bbox = [10.4, 10.4, 10.6, 10.6];
    publish(build("2026-10-15"));
    publishOther(build("2026-10-15", ["Makarora"]));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await vi.waitFor(() =>
      expect(registry.hasPlaceRegistry(OTHER.id)).toBe(true),
    );
    await vi.waitFor(() => expect(registry.hasPlaceRegistry(NSW)).toBe(true));
  });

  // Mutation: drop the chosen part of `regionsToKeep`.
  it("keeps current a region the user chose", async () => {
    prefs.set("placeRegistryWanted", "on");
    chosen.ids = [OTHER.id];
    publish(build("2026-10-15"));
    publishOther(build("2026-10-15", ["Makarora"]));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await vi.waitFor(() =>
      expect(registry.hasPlaceRegistry(OTHER.id)).toBe(true),
    );
    expect(registry.hasPlaceRegistry(NSW)).toBe(false);
  });

  // Mutation: add the regions the phone already holds to `regionsToKeep`, and a
  // copy of a region that is neither chosen nor saved over is refreshed for ever
  // and shows where the last user was interested.
  it("lets a copy lapse once its region is neither chosen nor saved over", async () => {
    prefs.set("placeRegistryWanted", "on");
    chosen.ids = [NSW];
    holdOnPhone(build("2026-09-15"));
    holdOtherOnPhone(build("2026-09-15", ["Old"]));
    publish(build("2026-10-15"));
    publishOther(build("2026-10-15", ["Makarora"]));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await vi.waitFor(() =>
      expect(registry.hasPlaceRegistry(OTHER.id)).toBe(false),
    );
    expect(
      [...files.keys()].filter((key) => key.startsWith(`${DIR}other`)),
    ).toEqual([]);
    // NSW's, chosen, was refreshed; the other's was never fetched.
    await vi.waitFor(() =>
      expect(registry.placeRegistryStatus(NSW).stored?.version).toBe(
        "2026-10-15",
      ),
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      OTHER_POINTER_URL,
    );
  });

  // Mutation: drop the `saved` part of `regionsToKeep` from the lapse's keep
  // list, and a region only a saved map touches loses its copy.
  it("keeps a copy for a region only a saved map touches", async () => {
    prefs.set("placeRegistryWanted", "on");
    artifacts.kinds = ["basemap-region"];
    artifacts.bbox = [10.4, 10.4, 10.6, 10.6];
    holdOtherOnPhone(build("2026-10-15", ["Makarora"]));
    publish(build("2026-10-15"));
    publishOther(build("2026-10-15", ["Makarora"]));
    const registry = await load();
    await registry.lapsePlaceRegistries();
    expect(registry.hasPlaceRegistry(OTHER.id)).toBe(true);
    expect((await registry.loadPlaceIndex(OTHER.id))?.names).toEqual([
      "Makarora",
    ]);
  });

  // The sign-out: the wipe has forgotten the chosen regions (the default
  // returns) and deleted the saved maps. Mutation: leave the copies of regions
  // not chosen in `lapsePlaceRegistries`' keep list (e.g. keep every region held).
  it("leaves only the default region's copy at sign-out", async () => {
    chosen.ids = [NSW];
    artifacts.kinds = [];
    holdOnPhone(build("2026-10-15", ["Wollangambe"]));
    holdOtherOnPhone(build("2026-10-15", ["Makarora"]));
    const registry = await load();
    await registry.lapsePlaceRegistries();
    expect([...files.keys()].sort()).toEqual([
      `${DIR}places-2026-10-15.json`,
      `${DIR}pointer.json`,
    ]);
    expect(registry.hasPlaceRegistry(OTHER.id)).toBe(false);
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Wollangambe",
    ]);
  });

  // With one region nothing changes. Mutation: leave `regionsOf(readRegions(),
  // REGIONS)` out of `regionsToKeep`, and the only region's copy is deleted.
  it("leaves the only region's copy alone, whatever the account has saved", async () => {
    chosen.ids = [NSW];
    artifacts.kinds = [];
    const only = build("2026-10-15", ["Wollangambe"]);
    holdOnPhone(only);
    const registry = await load();
    await registry.lapsePlaceRegistries();
    expect(files.has(`${DIR}pointer.json`)).toBe(true);
    expect(files.has(`${DIR}${only.pointer.path}`)).toBe(true);
    expect((await registry.loadPlaceIndex(NSW))?.names).toEqual([
      "Wollangambe",
    ]);
  });

  // A search that is loading the copy and a refresh that is fetching it when it
  // lapses. Mutation: drop `await copy.fetching?.promise` from `forgetCopy`, and
  // the fetch installs its build after the files went; drop the
  // `publish(region, { stored: null` from it, and the copy still reads as
  // stored, with a build whose files are gone.
  it("deletes a copy that a search is loading and a refresh is fetching", async () => {
    const old = build("2026-09-15", ["Old"]);
    holdOtherOnPhone(old);
    publishOther(build("2026-10-15", ["Makarora"]));
    let releaseLoad = () => {};
    held.set(
      `${DIR}other/${old.pointer.path}`,
      new Promise<void>((resolve) => {
        releaseLoad = resolve;
      }),
    );
    let releaseDownload = () => {};
    downloadGate.current = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    const registry = await load();
    const loading = registry.loadPlaceIndex(OTHER.id);
    const fetching = registry.fetchPlaceRegistry(OTHER.id, {
      allowMetered: true,
    });
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    const lapsing = registry.lapsePlaceRegistries();
    releaseDownload();
    expect(await fetching).toBe("updated");
    await lapsing;
    // The load was still reading when the files went.
    releaseLoad();
    expect(await loading).toBeNull();
    expect(
      [...files.keys()].filter((key) => key.startsWith(`${DIR}other`)),
    ).toEqual([]);
    expect(registry.placeRegistryStatus(OTHER.id)).toEqual({
      stored: null,
      loadFailed: false,
    });
    expect(registry.placeIndex(OTHER.id)).toBeNull();
  });
});
