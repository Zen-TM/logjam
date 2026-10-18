// A clip is cut on the phone from the public archive on the CDN: no request
// goes to Logjam's API, a request carries nothing but its byte range, and a
// failure says nothing about where (docs/decisions/0036).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
        readBytes(length: number) {
          const at = this.offset ?? 0;
          this.offset = at + length;
          return disk.get(uri)!.slice(at, at + length);
        },
        writeBytes(bytes: Uint8Array) {
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

const { fetchExtractRequest, planExtract } = await import("@logjam/shared");
const { resumeIndex, runRegionClip } = await import("./regionDownloads");

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

const run = (spec: object = SPEC) =>
  runRegionClip({ ...SPEC, ...spec }, () => {}, { stop: null });

beforeEach(() => {
  disk.clear();
  cdn.calls = [];
  cdn.failFrom = Infinity;
  cdn.status = 503;
  online.value = true;
  insertArtifact.mockClear();
});

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

  // Mutation: start every run from the top and the second run fetches every
  // range again; resume from the wrong request and the file differs.
  it("picks up where a failed run stopped, and says nothing about where", async () => {
    const { out, plan } = await reference();
    // A clean run, for its count: the directories, then every request.
    await run();
    const clean = cdn.calls.length;
    const reading = clean - plan.requests.length;
    disk.clear();
    cdn.calls = [];

    cdn.failFrom = reading + 3;
    const failed = await run();
    expect(failed).toMatchObject({ status: "failed", code: "unknown" });
    // No offset or length of any request reaches the row's text.
    const detail = (failed as { detail?: string }).detail ?? "";
    expect(detail).toMatch(/503/);
    for (const request of plan.requests) {
      expect(detail).not.toContain(String(request.offset));
    }

    cdn.calls = [];
    cdn.failFrom = Infinity;
    expect((await run()).status).toBe("ready");
    expect(disk.get(FILE)).toEqual(out);
    // The directories again, then all but the three requests already held.
    expect(cdn.calls.length).toBe(clean - 3);
  });

  it("waits for a connection that drops mid-clip", async () => {
    const serve = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (cdn.calls.length < 6) return serve(url, init);
      cdn.calls.push({ url, init });
      online.value = false;
      throw new Error("Network request failed");
    });
    vi.useFakeTimers();
    try {
      let outcome: unknown;
      const pending = run().then((o) => (outcome = o));
      while (outcome === undefined) await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(outcome).toEqual({ status: "paused", reason: "connectivity" });
      expect(disk.has(FILE)).toBe(true);
    } finally {
      vi.useRealTimers();
      fetchMock.mockImplementation(serve);
    }
  });

  it("leaves a DEM or contour archive the CDN lacks out of the run", async () => {
    cdn.failFrom = 0;
    cdn.status = 403;
    expect(await run({ demSourceId: "nsw-5m", basemapId: "nsw-5m" })).toEqual({
      status: "cancelled",
    });
    expect(await run({ contours: true })).toEqual({ status: "cancelled" });
    expect(await run()).toEqual({
      status: "failed",
      code: "source-unavailable",
    });
  });

  it("refuses a vector area outside the archive", async () => {
    const outside = { west: 140, south: -30, east: 140.5, north: -29.5 };
    expect(await run({ bbox: outside })).toMatchObject({
      status: "failed",
      code: "region-rejected",
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
