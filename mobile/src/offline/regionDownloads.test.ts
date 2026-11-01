// A clip is cut on the phone from the public archive on the CDN: no request
// goes to Logjam's API, a request carries nothing but its byte range, and a
// failure says nothing about where (docs/decisions/0036).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CDN = "https://cdn.test";
const fixture = new Uint8Array(
  readFileSync(
    new URL(
      "../../../shared/src/__fixtures__/pmtiles-extract/fixture.pmtiles",
      import.meta.url,
    ),
  ),
);

/** The CDN: serves the fixture by range, or the status a test sets. */
const cdn = vi.hoisted(() => ({
  failFrom: Infinity,
  status: 503,
  calls: [] as { url: string; init: { headers: Record<string, string> } }[],
}));
const fetchMock = vi.hoisted(() =>
  vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    cdn.calls.push({ url, init });
    if (cdn.calls.length > cdn.failFrom) {
      return { status: cdn.status, headers: new Headers() };
    }
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.range)!;
    const bytes = fixture.slice(Number(from), Number(to) + 1);
    return {
      status: 206,
      headers: new Headers({ etag: '"v1"' }),
      bytes: async () => bytes,
    };
  }),
);
vi.mock("expo/fetch", () => ({ fetch: fetchMock }));

/** App-private storage, in memory. */
const disk = vi.hoisted(() => new Map<string, Uint8Array>());
vi.mock("expo-file-system", () => {
  class File {
    constructor(readonly uri: string) {}
    get exists() {
      return disk.has(this.uri);
    }
    get size() {
      return disk.get(this.uri)?.length ?? 0;
    }
    create() {
      disk.set(this.uri, new Uint8Array(0));
    }
    delete() {
      disk.delete(this.uri);
    }
    open() {
      const uri = this.uri;
      return {
        offset: 0 as number | null,
        async readBytes(length: number) {
          const at = this.offset ?? 0;
          this.offset = at + length;
          return disk.get(uri)!.slice(at, at + length);
        },
        async writeBytes(bytes: Uint8Array) {
          const at = this.offset ?? 0;
          const old = disk.get(uri)!;
          const next = new Uint8Array(Math.max(old.length, at + bytes.length));
          next.set(old);
          next.set(bytes, at);
          disk.set(uri, next);
          this.offset = at + bytes.length;
        },
        close() {},
      };
    }
  }
  return { File, FileMode: { ReadWrite: "rw" } };
});
vi.mock("expo-file-system/legacy", () => ({
  makeDirectoryAsync: vi.fn(),
  deleteAsync: vi.fn(async (uri: string) => disk.delete(uri)),
}));
vi.mock("react-native", () => ({ AppState: { currentState: "active" } }));
vi.mock("../config", () => ({
  config: { apiUrl: "https://api.test", topoCdnBaseUrl: CDN },
}));
const insertArtifact = vi.hoisted(() => vi.fn());
vi.mock("./registryDb", () => ({ insertArtifact, deleteArtifact: vi.fn() }));
vi.mock("./freeSpace", () => ({ assertSpaceFor: vi.fn() }));
vi.mock("./localStores", () => ({ REGION_DIR: "file:///regions/" }));
const online = vi.hoisted(() => ({ value: true }));
vi.mock("./regionTileDownload", () => ({
  connectionAllows: async () => online.value,
}));
// Small requests, so the fixture's clip takes several and a resume has
// somewhere to resume from.
vi.mock("@logjam/shared", async (importOriginal) => {
  const shared = await importOriginal<typeof import("@logjam/shared")>();
  return {
    ...shared,
    planExtract: (source: unknown, options: { bbox: never }) =>
      shared.planExtract(source as never, {
        ...options,
        mergeGapBytes: 0,
        maxRequestBytes: 256,
      }),
  };
});

const { fetchExtractRequest, LAND_EDGE_MINZOOM, NSW_LAND_CLIP, planExtract } =
  await import("@logjam/shared");
const { resumeIndex, runRegionClip } = await import("./regionDownloads");
type RegionCancelToken = { stop: null | "pause" | "cancel" };

const BBOX = { west: 150.2, south: -33.8, east: 150.6, north: -33.4 };
const SPEC = {
  id: "c1",
  basemapId: "protomaps",
  label: "Vector map region",
  groupId: "g1",
  groupLabel: "Area",
  bbox: BBOX,
  allowCellular: false,
};
const FILE = "file:///regions/c1.pmtiles";

/** What the clip must hold: the same extract, straight from the fixture. */
async function reference() {
  const source = {
    getKey: () => "fixture",
    getBytes: async (offset: number, length: number) => ({
      data: fixture.slice(offset, offset + length).buffer,
    }),
  };
  const plan = await planExtract(source, { bbox: BBOX });
  const out = new Uint8Array(plan.totalBytes);
  out.set(plan.prefix);
  for (const request of plan.requests) {
    out.set(
      await fetchExtractRequest(source, plan, request),
      request.dstOffset,
    );
  }
  return { out, plan };
}

const run = (
  spec: object = SPEC,
  token = { stop: null } as RegionCancelToken,
) => runRegionClip({ ...SPEC, ...spec }, () => {}, token);

/** Runs a clip to its outcome, through the retries' back-off. */
async function settled(pending: Promise<unknown>) {
  let outcome: unknown;
  void pending.then((o) => (outcome = o));
  while (outcome === undefined) await vi.advanceTimersByTimeAsync(50);
  return outcome as Awaited<ReturnType<typeof runRegionClip>>;
}

const serve = fetchMock.getMockImplementation()!;
beforeEach(() => {
  disk.clear();
  cdn.calls = [];
  cdn.failFrom = Infinity;
  cdn.status = 503;
  online.value = true;
  insertArtifact.mockClear();
  fetchMock.mockImplementation(serve);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("runRegionClip", () => {
  // Mutations: send a header besides the range (an auth token, a client id),
  // or fetch from the API, and the loop goes red.
  it("cuts the clip from the CDN, asking for nothing but byte ranges", async () => {
    const outcome = await run();

    expect(outcome.status).toBe("ready");
    expect(disk.get(FILE)).toEqual((await reference()).out);
    expect(insertArtifact).toHaveBeenCalledOnce();
    expect(cdn.calls.length).toBeGreaterThan(3);
    for (const { url, init } of cdn.calls) {
      expect(url).toBe(`${CDN}/master/basemap/protomaps-nsw.pmtiles`);
      expect(Object.keys(init.headers)).toEqual(["range"]);
    }
  });

  // Mutations: start every run from the top and the second run fetches every
  // range again; resume from the wrong request and the file differs; put a
  // status's text or a request's offset into the row's detail and the
  // detail check goes red.
  it("picks up where a failed run stopped, and says nothing about where", async () => {
    const { out, plan } = await reference();
    // A clean run, for its count: the directories, then every request.
    await run();
    const clean = cdn.calls.length;
    const reading = clean - plan.requests.length;
    disk.clear();
    cdn.calls = [];

    cdn.failFrom = reading + 3;
    const failed = await settled(run());
    expect(failed).toEqual({ status: "failed", code: "unknown" });

    cdn.calls = [];
    cdn.failFrom = Infinity;
    expect((await run()).status).toBe("ready");
    expect(disk.get(FILE)).toEqual(out);
    // The directories again, then all but the three requests already held.
    expect(cdn.calls.length).toBe(clean - 3);
  });

  // Mutation: check the connection only before planning and the second half
  // goes red: a Wi-Fi-only clip carries on over mobile data.
  it("stops for a connection it may not use, before and during the clip", async () => {
    online.value = false;
    expect(await run()).toEqual({ status: "paused", reason: "connectivity" });
    expect(cdn.calls).toEqual([]);

    online.value = true;
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length >= 8) online.value = false;
      return serve(url, init);
    });
    expect(await run()).toEqual({ status: "paused", reason: "connectivity" });
    expect(disk.has(FILE)).toBe(true);
  });

  // Mutation: retry a network failure into the dead state with no connection
  // and the job fails instead of waiting for one.
  it("waits for a connection that drops mid-clip", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length < 6) return serve(url, init);
      cdn.calls.push({ url, init });
      online.value = false;
      throw new Error("Network request failed");
    });
    expect(await settled(run())).toEqual({
      status: "paused",
      reason: "connectivity",
    });
    expect(disk.has(FILE)).toBe(true);
  });

  // Mutation: read the token only between requests and a Stop pressed during
  // the retries comes back paused, to resume itself on the next reconnect.
  it("stays cancelled when Stop comes during a failing request", async () => {
    const token: RegionCancelToken = { stop: null };
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length < 6) return serve(url, init);
      cdn.calls.push({ url, init });
      token.stop = "cancel";
      online.value = false;
      throw new Error("Network request failed");
    });
    expect(await settled(run(SPEC, token))).toEqual({ status: "cancelled" });
    expect(disk.has(FILE)).toBe(false);
  });

  // Mutation: leave the fetch to finish on its own and the clock check goes
  // red: a cancel then waits out a slow request, longer than a wipe waits.
  it("aborts the request in flight on Stop", async () => {
    const token: RegionCancelToken = { stop: null };
    let abortedAfter = Infinity;
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length < 6) return serve(url, init);
      cdn.calls.push({ url, init });
      token.stop = "cancel";
      const began = Date.now();
      const { signal } = init as unknown as { signal: AbortSignal };
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => {
          abortedAfter = Date.now() - began;
          reject(new Error("Aborted"));
        }),
      );
    });
    expect(await settled(run(SPEC, token))).toEqual({ status: "cancelled" });
    // Well before the request's own timeout, whose floor is 30 s.
    expect(abortedAfter).toBeLessThan(5_000);
    expect(disk.has(FILE)).toBe(false);
  });

  // Mutation: retry the whole plan instead of each read and the count goes
  // red: one failed directory read then repeats every read before it.
  it("retries a failed read on its own, not the whole plan", async () => {
    await run();
    const clean = cdn.calls.length;
    disk.clear();
    cdn.calls = [];
    let failed = false;
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length === 2 && !failed) {
        failed = true;
        cdn.calls.push({ url, init });
        return { status: 503, headers: new Headers() };
      }
      return serve(url, init);
    });
    expect((await settled(run())).status).toBe("ready");
    expect(cdn.calls.length).toBe(clean + 1);
  });

  // Mutation: drop the heartbeat and no progress arrives while a request
  // hangs: the download's notice, and the CPU lock it renews, lapse.
  it("keeps the download alive through a slow request", async () => {
    const token: RegionCancelToken = { stop: null };
    const onProgress = vi.fn();
    let hanging = false;
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length < 6) return serve(url, init);
      cdn.calls.push({ url, init });
      hanging = true;
      const { signal } = init as unknown as { signal: AbortSignal };
      return new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("Aborted"))),
      );
    });
    const pending = runRegionClip(SPEC, onProgress, token);
    while (!hanging) await vi.advanceTimersByTimeAsync(50);
    const before = onProgress.mock.calls.length;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(onProgress.mock.calls.length).toBeGreaterThan(before);
    token.stop = "cancel";
    expect(await settled(pending)).toEqual({ status: "cancelled" });
  });

  // Mutations: drop a DEM, contour or slope clip on any status and a CDN outage
  // saves an area without them, unreported (the 503 line); report a missing
  // one and every area outside its coverage fails a map.
  it("leaves out a DEM or contour archive the CDN lacks, and only that", async () => {
    cdn.failFrom = 0;
    cdn.status = 403;
    const dem = { demSourceId: "nsw-5m", basemapId: "nsw-5m" };
    expect(await run(dem)).toEqual({ status: "cancelled" });
    expect(await run({ contours: true })).toEqual({ status: "cancelled" });
    expect(await run({ slope: true })).toEqual({ status: "cancelled" });
    expect(await run({ land: true })).toEqual({ status: "cancelled" });
    expect(await run()).toEqual({
      status: "failed",
      code: "source-unavailable",
    });
    cdn.status = 200;
    expect(await run(dem)).toEqual({
      status: "failed",
      code: "source-unavailable",
    });
    cdn.status = 503;
    expect(await settled(run(dem))).toEqual({
      status: "failed",
      code: "unknown",
    });
  });

  // Mutation: file the slope clip as a raster, or under the basemap's key,
  // and offline the map draws the terrarium PNGs as noise, or not at all.
  it("files a slope clip as the DEM the map colours", async () => {
    expect((await run({ slope: true })).status).toBe("ready");
    for (const { url } of cdn.calls)
      expect(url).toBe(`${CDN}/master/dem/nsw-5m-slope.pmtiles`);
    expect(insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "slope-region",
        logicalKey: "nsw-5m-slope",
        sourceType: "raster-dem",
        minzoom: 8,
      }),
    );
  });

  // Mutation: cut Land from the archive's own z8, and a saved area carries
  // about five times the bytes in zooms no map draws.
  it("cuts a land clip from the zoom a map draws it", async () => {
    expect((await run({ land: true })).status).toBe("ready");
    for (const { url } of cdn.calls)
      expect(url).toBe(`${CDN}/${NSW_LAND_CLIP.archivePath}`);
    expect(insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "land-region",
        logicalKey: NSW_LAND_CLIP.id,
        minzoom: LAND_EDGE_MINZOOM,
      }),
    );
  });

  // Mutation: revert `clipArchiveFor` to `dem.sampleZoom` and the height clip
  // holds z15 alone, so the hillshade vanishes offline below z15 while the
  // estimate still prices z8-14.
  it("cuts the nsw-5m height clip from z8, not from the sampler's z15", async () => {
    const dem = { demSourceId: "nsw-5m", basemapId: "nsw-5m" };
    expect((await run(dem)).status).toBe("ready");
    for (const { url } of cdn.calls)
      expect(url).toBe(`${CDN}/master/dem/nsw-5m.pmtiles`);
    expect(insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "dem-region",
        logicalKey: "nsw-5m",
        minzoom: 8,
        // The fixture archive stops at z14; the clip's z15 is in `clipArchiveFor`.
        maxzoom: 14,
      }),
    );
  });

  // A sharpened area's clip: cut from the bucket through the presigned URL,
  // filed under the area's source id, its bounds its z15 tiles.
  // Mutations: cut it from the CDN, file it under the statewide key, keep
  // the saved area's bbox, or let an expired URL drop it silently, and a line
  // here goes red.
  it("cuts a sharpened area's clip through its presigned URL, filed under the area", async () => {
    const { tileRectBounds, tileRectCovering } = await import(
      "../map/terrainRoutes"
    );
    const [x0, y0, x1, y1] = tileRectCovering(15, [150.3, -33.7, 150.4, -33.6]);
    const tiles = [x0 & ~1, y0 & ~1, x1 | 1, y1 | 1] as const;
    const url =
      "https://bucket.example/outputs/a1/contours.pmtiles?X-Amz-Signature=s";
    const area = { id: "a1", layer: "contours", url, zmax: 17, tiles };
    expect((await run({ basemapId: "lidar-a1", area })).status).toBe("ready");
    for (const call of cdn.calls) {
      expect(call.url).toBe(url);
      expect(Object.keys(call.init.headers)).toEqual(["range"]);
    }
    expect(insertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "contours-region",
        logicalKey: "lidar-a1",
        sourceType: "vector",
        bbox: tileRectBounds(15, tiles),
        minzoom: 14,
        maxzoom: 14,
      }),
    );
    cdn.failFrom = 0;
    cdn.status = 403;
    expect(await run({ basemapId: "lidar-a1", area })).toEqual({
      status: "failed",
      code: "source-unavailable",
      detail: "sharpened-area",
    });
    // A host refusing ranges is no expired link.
    cdn.status = 416;
    expect(await run({ basemapId: "lidar-a1", area })).toEqual({
      status: "failed",
      code: "source-unavailable",
    });
  });

  // Mutation: save the clip of an area outside the archive and the first
  // line goes red with a file of a few low-zoom tiles.
  it("refuses a vector area outside the archive", async () => {
    const outside = { west: 140, south: -30, east: 140.5, north: -29.5 };
    expect(await run({ bbox: outside })).toEqual({
      status: "failed",
      code: "region-rejected",
      detail: "outside-nsw",
    });
    expect(await run({ bbox: outside, contours: true })).toEqual({
      status: "cancelled",
    });
    expect(disk.size).toBe(0);
  });
});

describe("resumes", () => {
  const plan = {
    prefix: Uint8Array.from([1, 2, 3]),
    requests: [
      { offset: 0, length: 4, dstOffset: 3, keep: [{ at: 0, length: 4 }] },
      { offset: 9, length: 4, dstOffset: 7, keep: [{ at: 0, length: 4 }] },
    ],
  };

  // Mutation: skip the prefix comparison and a clip of a rebuilt archive is
  // finished with the old one's tiles.
  it("starts again from a file cut from something else", () => {
    expect(resumeIndex(plan, Uint8Array.from([1, 2, 4]), 11)).toBeNull();
    expect(resumeIndex(plan, null, 2)).toBeNull();
  });

  it("goes on from the first request the file does not hold all of", () => {
    const prefix = Uint8Array.from([1, 2, 3]);
    expect(resumeIndex(plan, prefix, 3)).toBe(0);
    expect(resumeIndex(plan, prefix, 7)).toBe(1);
    expect(resumeIndex(plan, prefix, 10)).toBe(1);
    expect(resumeIndex(plan, prefix, 11)).toBe(2);
  });
});
