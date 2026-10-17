import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  indexPlaceRegistry,
  searchPlaces,
  type PlaceRegistryFile,
} from "@logjam/shared";
import { gzipSync, strFromU8, strToU8 } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

// When the place registry is fetched, on what connection, and that a bad
// download never replaces a good file (ADR 0034). The filesystem, the CDN and
// NetInfo are fakes; the decisions and the swap are the real module.

const DIR = "file:///docs/place-registry/";
const CDN = "https://cdn.test";
const POINTER_URL = `${CDN}/master/places/v1/latest.json`;

const files = new Map<string, Uint8Array | string>();
/** What lands on the phone for a URL: the pointer as JSON, a data file as
 *  the platform saved it (plain JSON, after its Content-Encoding: gzip). */
const served = new Map<string, unknown>();
const prefs = new Map<string, string>();
/** Every file read whole into memory, as "text" or "bytes", and its URI. */
const reads: string[] = [];
const artifacts = { kinds: [] as string[] };
const network = { expensive: false, connected: true };
const disk = { free: 1e12 };
/** A filesystem call to fail once, by name. */
const failing = new Set<string>();
/** Reads held until their promise settles, by URI. */
const held = new Map<string, Promise<void>>();
const offlineOnly = { on: false };

const download = vi.hoisted(() => vi.fn());
vi.mock("../api/presignedTransfer", () => ({
  downloadFromPresignedUrl: download,
}));
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: async () => {},
  deleteAsync: async (uri: string) => {
    for (const key of [...files.keys()]) {
      if (key === uri || (uri.endsWith("/") && key.startsWith(uri))) {
        files.delete(key);
      }
    }
  },
  getFreeDiskStorageAsync: async () => disk.free,
  moveAsync: async ({ from, to }: { from: string; to: string }) => {
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
    const body = files.get(uri) as Uint8Array;
    return Buffer.from(
      body.slice(options.position, options.position + options.length),
    ).toString("base64");
  },
  readDirectoryAsync: async (dir: string) =>
    [...files.keys()]
      .filter((key) => key.startsWith(dir))
      .map((key) => key.slice(dir.length)),
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
  InteractionManager: { runAfterInteractions: (run: () => void) => run() },
}));
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
  listArtifacts: async () => artifacts.kinds.map((kind) => ({ kind })),
}));

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
  network.expensive = false;
  network.connected = true;
  offlineOnly.on = false;
  disk.free = 1e12;
  failing.clear();
  held.clear();
  fetchMock.mockClear();
  download.mockReset().mockImplementation(async (url: string, to: string) => {
    const body = served.get(url);
    if (!(body instanceof Uint8Array)) return { status: 404 };
    files.set(to, body);
    return { status: 200 };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the first download", () => {
  it("comes with the first region download, from the CDN with nothing else sent", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    registry.placeRegistryWithRegion(false);
    await registry.fetchPlaceRegistry({});
    expect(registry.hasPlaceRegistry()).toBe(true);
    // Mutation: add headers (a token, an account id) to the pointer request.
    expect(fetchMock.mock.calls[0]).toEqual([
      POINTER_URL,
      { signal: expect.any(AbortSignal) },
    ]);
  });

  it("goes on mobile data when the user allowed it for the maps", async () => {
    network.expensive = true;
    publish(build("2026-10-15"));
    const registry = await load();
    registry.placeRegistryWithRegion(true);
    await registry.fetchPlaceRegistry({ allowMetered: true });
    expect(registry.hasPlaceRegistry()).toBe(true);
  });

  it("is not fetched again by a region download after the user removed it", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    await registry.requestPlaceRegistry();
    await registry.removePlaceRegistry();
    registry.placeRegistryWithRegion(false);
    expect(await registry.refreshPlaceRegistry()).toBe("skipped");
    expect(registry.hasPlaceRegistry()).toBe(false);
    expect([...files.keys()]).toEqual([]);
  });
});

describe("a phone that held a region before Logjam GPS had the file", () => {
  // Mutation: drop `adoptForSavedRegions` from the start-up check.
  it("counts as having asked, and fetches it at app start", async () => {
    artifacts.kinds = ["basemap-region", "dem-region"];
    publish(build("2026-10-15"));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await vi.waitFor(() => expect(registry.hasPlaceRegistry()).toBe(true));
    expect(prefs.get("placeRegistryWanted")).toBe("on");
  });

  // Mutation: adopt whenever the pref is not "on", not only when never set.
  it.each([
    ["a user who removed it", "off", ["basemap-region"]],
    ["a phone with no saved region", undefined, ["topo-overlay"]],
  ])("fetches nothing for %s", async (_case, wanted, kinds) => {
    if (wanted) prefs.set("placeRegistryWanted", wanted);
    artifacts.kinds = kinds;
    publish(build("2026-10-15"));
    const registry = await load();
    registry.registerPlaceRegistryRefresh();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prefs.get("placeRegistryWanted")).toBe(wanted);
  });
});

describe("the saved file", () => {
  // Mutation: gunzip every file, or read it as bytes.
  it("is read as the plain JSON the platform saved", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    await registry.requestPlaceRegistry();
    await registry.loadPlaceIndex();
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
    expect(await registry.requestPlaceRegistry()).toBe("updated");
    expect((await registry.loadPlaceIndex())?.names).toEqual(["Wollangambe"]);
  });
});

describe("the refresh", () => {
  it("fetches nothing for a phone that never asked for the file", async () => {
    publish(build("2026-10-15"));
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mutation: drop the `canRunNow("placeNames")` check from the refresh.
  it("waits for Wi-Fi by default", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    network.expensive = true;
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();

    network.expensive = false;
    expect(await registry.refreshPlaceRegistry()).toBe("updated");
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
    expect(await registry.refreshPlaceRegistry()).toBe("updated");
  });

  it("does nothing in offline-only mode", async () => {
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    offlineOnly.on = true;
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("offline-only");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads nothing when the phone has the current build", async () => {
    const current = build("2026-10-15");
    holdOnPhone(current);
    prefs.set("placeRegistryWanted", "on");
    publish(current);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("current");
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
    expect(await registry.refreshPlaceRegistry()).toBe("failed");
    expect([...files.keys()].sort()).toEqual(
      [`${DIR}places-2026-09-15.json`, `${DIR}pointer.json`].sort(),
    );
    const index = await registry.loadPlaceIndex();
    expect(index?.names).toEqual(["Mount Solitary", "Narrow Neck"]);
  });

  // Mutation: drop the size check before gunzipping.
  it("never gunzips a gzip download that is not the size its pointer says", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"), half(build("2026-10-15").gzipped));
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("failed");
    expect(reads).not.toContain(`bytes ${DIR}download.tmp`);
  });

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
    expect(await registry.refreshPlaceRegistry()).toBe("failed");
    expect(registry.hasPlaceRegistry()).toBe(true);
  });
});

describe("free space", () => {
  // The file is saved decompressed, so it needs more than the pointer's bytes.
  const needs = (built: ReturnType<typeof build>) => built.plain.length;

  // Mutation: drop the `assertSpaceFor` call.
  it("refuses a download the user asked for, saying so", async () => {
    const built = build("2026-10-15");
    publish(built);
    disk.free = needs(built);
    const registry = await load();
    const toasts: string[] = [];
    registry.onPlaceRegistryToast(({ text }) => toasts.push(text));
    expect(await registry.requestPlaceRegistry()).toBe("failed");
    expect(download).not.toHaveBeenCalled();
    expect(toasts).toEqual([expect.stringMatching(/^Needs about/)]);
  });

  // Mutation: drop the `hasSpaceFor` call.
  it("skips a refresh that would not fit", async () => {
    const built = build("2026-10-15");
    prefs.set("placeRegistryWanted", "on");
    publish(built);
    disk.free = needs(built);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("skipped");
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
    const refresh = registry.refreshPlaceRegistry();
    const asked = registry.requestPlaceRegistry();
    expect(await refresh).toBe("skipped");
    expect(await asked).toBe("updated");
  });
});

describe("what Download says", () => {
  // Mutation: toast from `fetchPlaceRegistry`, for every caller.
  it("toasts the user's own download, and nothing for a region's", async () => {
    network.connected = false;
    const registry = await load();
    const toasts: string[] = [];
    registry.onPlaceRegistryToast(({ text }) => toasts.push(text));
    registry.placeRegistryWithRegion(false);
    await registry.fetchPlaceRegistry({});
    expect(toasts).toEqual([]);
    await registry.requestPlaceRegistry();
    expect(toasts).toEqual(["Needs a connection"]);
  });
});

describe("a load that fails", () => {
  // Mutation: forget the file on any error.
  it("keeps the file after a read that failed for another reason", async () => {
    holdOnPhone(build("2026-09-15", ["Narrow Neck"]));
    failing.add("read");
    const registry = await load();
    expect(await registry.loadPlaceIndex()).toBeNull();
    expect(registry.hasPlaceRegistry()).toBe(true);
    expect((await registry.loadPlaceIndex())?.names).toEqual(["Narrow Neck"]);
  });

  // Mutation: keep a file that does not match its pointer.
  it("forgets a file that is not the build its pointer names", async () => {
    const built = build("2026-09-15");
    holdOnPhone(built, half(built.plain));
    const registry = await load();
    expect(await registry.loadPlaceIndex()).toBeNull();
    expect(registry.hasPlaceRegistry()).toBe(false);
    expect(files.has(`${DIR}pointer.json`)).toBe(false);
  });

  // Mutation: drop the `UNREADABLE_PREF_KEY` check in `runFetch`, or key it
  // by the version rather than the path.
  it("never fetches again a build that would not index, but fetches its fixed rebuild", async () => {
    const unindexable = build("2026-10-15", ["Narrow Neck"], 2);
    prefs.set("placeRegistryWanted", "on");
    publish(unindexable);
    const registry = await load();
    expect(await registry.refreshPlaceRegistry()).toBe("updated");
    expect(await registry.loadPlaceIndex()).toBeNull();
    expect(registry.hasPlaceRegistry()).toBe(false);
    download.mockClear();
    expect(await registry.refreshPlaceRegistry()).toBe("unreadable");
    expect(download).not.toHaveBeenCalled();
    // Rebuilt from the same extract: same version, a new content hash.
    const fixed = build("2026-10-15", ["Narrow Neck"]);
    fixed.pointer.path = "places-2026-10-15-fixed.json";
    publish(fixed);
    expect(await registry.refreshPlaceRegistry()).toBe("updated");
    expect((await registry.loadPlaceIndex())?.names).toEqual(["Narrow Neck"]);
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
    const old = registry.loadPlaceIndex();
    await registry.refreshPlaceRegistry();
    const fresh = registry.loadPlaceIndex();
    release();
    expect(await old).toBeNull();
    expect((await fresh)?.names).toEqual(["Wollangambe"]);
    expect(registry.placeIndex()?.names).toEqual(["Wollangambe"]);
  });

  it("is dropped by a refresh, and the next search builds the new one", async () => {
    holdOnPhone(build("2026-09-15"));
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15", ["Wollangambe"]));
    const registry = await load();
    expect(registry.placeIndex()).toBeNull();
    await registry.loadPlaceIndex();
    await registry.refreshPlaceRegistry();
    expect(registry.placeIndex()).toBeNull();
    expect((await registry.loadPlaceIndex())?.names).toEqual(["Wollangambe"]);
  });

  // Mutation: build it with `indexPlaceRegistry`, in one block.
  it("is built a slice at a time, letting timers run between slices", async () => {
    const names = Array.from({ length: 60_000 }, (_, at) => `Peak ${at}`);
    holdOnPhone(build("2026-10-15", names));
    const registry = await load();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const index = await registry.loadPlaceIndex();
    expect(index?.names).toHaveLength(60_000);
    expect(
      timer.mock.calls.filter(([, ms]) => ms === 0).length,
    ).toBeGreaterThan(1);
    timer.mockRestore();
  });

  // Mutation: leave `index` set in `removePlaceRegistry`. The search box reads
  // it from here on every render, never a copy (MapSearchBar.tsx).
  it("is freed by Remove", async () => {
    holdOnPhone(build("2026-09-15"));
    const registry = await load();
    await registry.loadPlaceIndex();
    await registry.removePlaceRegistry();
    expect(registry.placeIndex()).toBeNull();
  });

  it("is not built by a refresh nobody searched after", async () => {
    prefs.set("placeRegistryWanted", "on");
    publish(build("2026-10-15"));
    const registry = await load();
    await registry.refreshPlaceRegistry();
    expect(registry.placeIndex()).toBeNull();
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
      expect(await registry.requestPlaceRegistry()).toBe("updated");
      const index = await registry.loadPlaceIndex();
      if (!index) throw new Error("the fixture did not load");
      const expected = searchPlaces(indexPlaceRegistry(fixture), query, 8);
      expect(expected.length).toBeGreaterThan(0);
      expect(searchPlaces(index, query, 8)).toEqual(expected);
    },
  );
});
