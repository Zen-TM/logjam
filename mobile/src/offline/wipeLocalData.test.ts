import { beforeEach, describe, expect, it, vi } from "vitest";

import { SYNC_TABLES } from "../sync/mirrorSchema";
import { wipeAllLocalData } from "./wipeLocalData";

// wipeAllLocalData is the privacy boundary between two users of one phone;
// localStores.test.ts only guards that the stores are declared. These tests
// guard that the wipe acts on the declarations, in the right order, and that
// one failing store does not spare the rest.

const events: string[] = [];
let failOn: ((event: string) => boolean) | null = null;

function record(event: string) {
  events.push(event);
  if (failOn?.(event)) throw new Error(`boom: ${event}`);
}

function fakeDb() {
  return {
    execAsync: () => Promise.resolve(),
    getFirstAsync: () => Promise.resolve(null),
    getAllAsync: () => Promise.resolve([]),
    runAsync: (sql: string) => {
      record(`sql:${sql}`);
      return Promise.resolve({ changes: 0, lastInsertRowId: 0 });
    },
    withTransactionAsync: (task: () => Promise<void>) => task(),
  };
}

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: () => Promise.resolve(fakeDb()),
}));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: (uri: string) => {
    record(`delete:${uri}`);
    return Promise.resolve();
  },
  readDirectoryAsync: () => Promise.resolve([]),
}));
// The real file reaches react-native (Flow syntax vitest cannot parse).
vi.mock("./localStores", () => ({
  CACHE_ROOT: "file:///cache/",
  WIPED_DIRS: [
    "file:///docs/offline/regions/",
    "file:///docs/imports/",
    "file:///cache/logjam-scratch/",
  ],
}));
vi.mock("./registryDb", () => ({
  getOfflineDb: () => Promise.resolve(fakeDb()),
  notifyRegistryChanged: () => {},
}));
vi.mock("./demLookup", () => ({ clearOfflineDemCache: () => {} }));
vi.mock("../api/apiFetch", () => ({ invalidateCurrentUser: () => {} }));
vi.mock("./regionDownloadQueue", () => ({
  cancelAllRegionDownloads: () => {
    record("stop:regions");
    return Promise.resolve();
  },
}));
vi.mock("../geopdf/importRunner", () => ({
  stopGeoPdfImportRun: () => {
    record("stop:geopdf");
    return Promise.resolve();
  },
}));
vi.mock("../tracks/trackRecorder", () => ({
  stopTrackRecordingForWipe: () => {
    record("stop:track");
    return Promise.resolve();
  },
}));
vi.mock("../map/sharpenedArchives", () => ({
  stopSharpenedAreasForWipe: () => record("stop:sharpened"),
}));
vi.mock("./sharpenedAreaStore", () => ({
  forgetSharpenedAreas: () => {
    record("stop:sharpened-areas");
    return Promise.resolve();
  },
}));
vi.mock("../weather/weatherStorage", () => ({
  stopWeatherForWipe: () => {
    record("stop:weather");
    return Promise.resolve();
  },
}));
const resetDatabase = vi.hoisted(() => vi.fn());
vi.mock("@maplibre/maplibre-react-native", () => ({
  OfflineManager: { resetDatabase: () => resetDatabase() },
}));
vi.mock("../sync/syncDb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/syncDb")>()),
  notifyMirrorChanged: () => {},
}));

beforeEach(() => {
  events.length = 0;
  failOn = null;
  resetDatabase.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("wipeAllLocalData", () => {
  // Red if a directory is dropped from the loop (or from WIPED_DIRS' use).
  it("deletes every declared directory", async () => {
    const { failed } = await wipeAllLocalData();
    expect(failed).toEqual([]);
    for (const dir of [
      "file:///docs/offline/regions/",
      "file:///docs/imports/",
      "file:///cache/logjam-scratch/",
    ]) {
      expect(events).toContain(`delete:${dir}`);
    }
  });

  // Red if wipeAllSyncData stops iterating SYNC_TABLES (mirror, outbox,
  // conflict shelf) or the wipe stops calling it.
  it("clears every declared sync table", async () => {
    await wipeAllLocalData();
    for (const table of SYNC_TABLES) {
      expect(events).toContain(`sql:DELETE FROM ${table.name}`);
    }
  });

  // Red if a table is dropped from OFFLINE_TABLES (map_artifact, tracks, route
  // drafts) or its DELETE is replaced by something that spares rows.
  it("clears the offline registry tables and drops the legacy waypoint table", async () => {
    await wipeAllLocalData();
    for (const table of [
      "map_artifact",
      "track",
      "track_point",
      "geo_pdf_import",
      "route_draft",
    ]) {
      expect(events).toContain(`sql:DELETE FROM ${table}`);
    }
    expect(events).toContain("sql:DROP TABLE IF EXISTS waypoint");
  });

  // Red if the stop calls move after (or are removed from before) the first
  // delete: a live producer would re-create what the wipe just removed, and
  // the sharpened areas' transforms would keep their presigned URLs.
  it("stops every producer before deleting anything", async () => {
    await wipeAllLocalData();
    const firstDelete = events.findIndex((e) => /^(sql|delete):/.test(e));
    for (const stop of [
      "stop:regions",
      "stop:geopdf",
      "stop:track",
      "stop:weather",
      "stop:sharpened",
      "stop:sharpened-areas",
    ]) {
      const at = events.indexOf(stop);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(firstDelete);
    }
  });

  // Red if the per-directory try/catch is removed or hoisted around the loop,
  // so one failing delete aborts the rest or goes unreported.
  it("reports a failing store and still clears the others", async () => {
    failOn = (e) => e === "delete:file:///docs/imports/";
    const { failed } = await wipeAllLocalData();
    expect(failed).toContain("downloaded files");
    expect(events).toContain("delete:file:///cache/logjam-scratch/");
    expect(events).toContain("sql:DELETE FROM map_artifact");
  });

  // Red if the area epoch moves after the area list is forgotten: a list
  // landing while the wipe waits would pass the epoch check and put the
  // departing account's areas back after the forget.
  it("moves the sharpened areas' epoch before it forgets the area list", async () => {
    await wipeAllLocalData();
    expect(events.indexOf("stop:sharpened")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("stop:sharpened")).toBeLessThan(
      events.indexOf("stop:sharpened-areas"),
    );
  });

  // Red if a failure in the mirror wipe is swallowed or aborts the later steps.
  it("reports a failing sync wipe and still clears the offline registry", async () => {
    failOn = (e) => e === `sql:DELETE FROM ${SYNC_TABLES[0].name}`;
    const { failed } = await wipeAllLocalData();
    expect(failed).toContain("synced data");
    expect(events).toContain("sql:DELETE FROM map_artifact");
  });
});

// The sign-out wipe resets MapLibre's ambient tile cache, and a failure there
// is reported rather than swallowed. Dropping the `resetDatabase` call turns
// the first test red; dropping the `failed.push("map tile cache")` turns the
// second red.
describe("wipeAllLocalData and the MapLibre tile cache", () => {
  it("resets the ambient cache and reports a clean wipe", async () => {
    expect(await wipeAllLocalData()).toEqual({ failed: [] });
    expect(resetDatabase).toHaveBeenCalledOnce();
  });

  it("names the tile cache as failed, and still clears the rest", async () => {
    resetDatabase.mockRejectedValue(new Error("boom"));
    expect(await wipeAllLocalData()).toEqual({ failed: ["map tile cache"] });
    expect(events).toContain("sql:DELETE FROM map_artifact");
  });
});
