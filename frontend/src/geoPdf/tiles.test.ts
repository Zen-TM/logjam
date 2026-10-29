import { afterEach, describe, expect, it, vi } from "vitest";
import { geoPdfFileName } from "./client";
import { pmtiles } from "../../e2e/__fixtures__/geoPdfTiles";
import {
  fetchBytes,
  hostClassOf,
  HOST_LIMITS,
  limitFor,
  openArchive,
  Scheduler,
} from "./tiles";

const ORIGIN = "https://app.example";

describe("hostClassOf / limitFor", () => {
  it("tells same-origin archives, presigned S3 and a tile host apart", () => {
    expect(hostClassOf(`${ORIGIN}/master/dem/x.pmtiles`, ORIGIN)).toBe(
      "statewide",
    );
    expect(
      hostClassOf(
        "https://b.s3.ap-southeast-2.amazonaws.com/k?X-Amz=1",
        ORIGIN,
      ),
    ).toBe("presigned");
    expect(
      hostClassOf("https://tile.openstreetmap.org/1/2/3.png", ORIGIN),
    ).toBe("tile.openstreetmap.org");
  });

  // Mutation: raise a third-party number past its policy, or drop the default.
  it("keeps third parties modest and unknown hosts at the default", () => {
    expect(limitFor("statewide")).toBe(HOST_LIMITS.statewide);
    expect(limitFor("presigned")).toBe(HOST_LIMITS.presigned);
    expect(limitFor("a.tile.opentopomap.org")).toBeLessThanOrEqual(
      HOST_LIMITS.other,
    );
    expect(limitFor("tile.openstreetmap.org")).toBeLessThanOrEqual(
      HOST_LIMITS.other,
    );
    expect(limitFor("tiles.example")).toBe(HOST_LIMITS.other);
  });
});

describe("Scheduler", () => {
  const gate = () => {
    let open!: () => void;
    const p = new Promise<void>((r) => (open = r));
    return { p, open };
  };

  // Mutation: start tasks in arrival order, or ignore the limit.
  it("starts the lowest priority first and never more than the limit at once", async () => {
    const s = new Scheduler(new AbortController().signal, () => 2);
    const started: string[] = [];
    let live = 0;
    let peak = 0;
    const gates = ["a", "b", "c", "d"].map(() => gate());
    const run = (name: string, priority: number, i: number) =>
      s.run("h", priority, async () => {
        started.push(name);
        peak = Math.max(peak, ++live);
        await gates[i]!.p;
        live--;
      });
    const all = [
      run("late", 9, 0),
      run("early", 1, 1),
      run("mid", 5, 2),
      run("tie", 5, 3),
    ];
    // "late" started at once (nothing queued yet), and so did "early".
    await Promise.resolve();
    expect(started).toEqual(["late", "early"]);
    gates[0]!.open();
    await Promise.resolve();
    await Promise.resolve();
    gates[1]!.open();
    gates[2]!.open();
    gates[3]!.open();
    await Promise.all(all);
    expect(started).toEqual(["late", "early", "mid", "tie"]);
    expect(peak).toBe(2);
  });

  it("rejects what is still waiting when it aborts, and starts nothing more", async () => {
    const ctl = new AbortController();
    const s = new Scheduler(ctl.signal, () => 1);
    const g = gate();
    const first = s.run("h", 0, () => g.p);
    const waiting = s.run("h", 1, async () => "ran");
    ctl.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    g.open();
    await first;
    await expect(s.run("h", 0, async () => 1)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("fetchBytes", () => {
  afterEach(() => vi.unstubAllGlobals());
  const response = (status: number, body = "x") =>
    new Response(body, {
      status,
      headers: { "content-length": String(body.length) },
    });

  // Mutation: no retry, or retry a 404.
  it("retries a 503 once and returns the second answer", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200, "ok"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchBytes(
      "https://t.example/1",
      new AbortController().signal,
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a network error once, then gives up", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("net"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchBytes("https://t.example/1", new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404));
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchBytes(
      "https://t.example/1",
      new AbortController().signal,
    );
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to read a whole archive from a server that ignores Range", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(200, "x".repeat(100))),
    );
    await expect(
      fetchBytes("https://t.example/a.pmtiles", new AbortController().signal, {
        offset: 0,
        length: 10,
      }),
    ).rejects.toThrow();
  });
});

describe("geoPdfFileName", () => {
  it("names the file from the title, safely, with a default", () => {
    expect(geoPdfFileName("My trip / 2026!")).toBe("My trip 2026.pdf");
    expect(geoPdfFileName(undefined)).toBe("logjam-geopdf.pdf");
    expect(geoPdfFileName("???")).toBe("logjam-geopdf.pdf");
    expect(geoPdfFileName("a".repeat(200))).toBe(`${"a".repeat(80)}.pdf`);
  });
});

// ── Merged range reads, and what the persistent cache may keep ──────────────

/** An archive of five z15 tiles side by side (x 0..4 on one row) and one far off. */
function archiveBytes() {
  const tile = (x: number, y: number) => ({
    z: 15,
    x,
    y,
    data: Buffer.alloc(40 + x, x + 1),
  });
  return pmtiles([0, 1, 2, 3, 4].map((x) => tile(x, 0)).concat(tile(9, 9)), 2);
}

/** A fetch over `body` that honours Range, counting the ranges it was asked for. */
function serve(
  body: Buffer,
  opts: { etag?: string | (() => string); failMerged?: boolean } = {},
) {
  const asked: [number, number][] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range")!;
    const [a, b] = /bytes=(\d+)-(\d+)/.exec(range)!.slice(1).map(Number) as [
      number,
      number,
    ];
    asked.push([a, b - a + 1]);
    if (opts.failMerged && b - a + 1 > 50 && a > 0)
      return new Response("no", { status: 404 });
    const slice = body.subarray(a, Math.min(b + 1, body.length));
    return new Response(
      slice.buffer.slice(
        slice.byteOffset,
        slice.byteOffset + slice.length,
      ) as ArrayBuffer,
      {
        status: 206,
        headers: {
          "content-length": String(slice.length),
          ...(opts.etag
            ? {
                etag: typeof opts.etag === "function" ? opts.etag() : opts.etag,
              }
            : {}),
        },
      },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return asked;
}

const tileLen = (x: number) => 40 + x;
const pending = () => new AbortController().signal;

describe("openArchive range merging", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Mutation: drop the etag comparison in RangeSource.getBytes: a tile read
  // from a replaced archive is decoded through the old directory.
  it("reads again from the header when the archive changes mid-render", async () => {
    let answers = 0;
    // The header read is the first answer; the archive is replaced after it.
    const asked = serve(archiveBytes(), {
      etag: () => (answers++ === 0 ? '"v1"' : '"v2"'),
    });
    const archive = openArchive(`${ORIGIN}/master/a.pmtiles`, pending());
    const tile = await archive.getZxy(15, 0, 0);
    expect(tile!.data.byteLength).toBe(40);
    // header, the tile under a stale etag, then the header again and the tile.
    expect(asked.filter(([offset]) => offset === 0)).toHaveLength(2);
  });

  // Mutation: send each read on its own (drop the merge in RangeSource.flush)
  // and the tiles take five requests.
  it("reads tiles that sit end to end as one request, and gives each its own bytes", async () => {
    const asked = serve(archiveBytes());
    const archive = openArchive(`${ORIGIN}/master/a.pmtiles`, pending());
    await archive.getHeader();
    const tiles = await Promise.all(
      [0, 1, 2, 3, 4].map((x) => archive.getZxy(15, x, 0)),
    );
    tiles.forEach((t, x) => {
      expect(t!.data.byteLength).toBe(tileLen(x));
      expect(new Uint8Array(t!.data)[0]).toBe(x + 1);
    });
    // header (and with it the directory) once, then one read for the five tiles.
    expect(asked).toHaveLength(2);
    expect(asked[1]![1]).toBe(40 + 41 + 42 + 43 + 44);
  });

  // Mutation: join every read in a tick whatever lies between them (drop the
  // `w.offset !== end` test in RangeSource.flush): the gap is fetched too.
  it("does not join tiles with something between them", async () => {
    const asked = serve(archiveBytes());
    const archive = openArchive(`${ORIGIN}/master/a.pmtiles`, pending());
    await archive.getHeader();
    await Promise.all([archive.getZxy(15, 0, 0), archive.getZxy(15, 9, 9)]);
    expect(asked).toHaveLength(3);
  });

  it("asks for each tile on its own when the merged read fails", async () => {
    const asked = serve(archiveBytes(), { failMerged: true });
    const archive = openArchive(`${ORIGIN}/master/a.pmtiles`, pending());
    await archive.getHeader();
    const tiles = await Promise.all(
      [0, 1, 2].map((x) => archive.getZxy(15, x, 0)),
    );
    expect(tiles.map((t) => t!.data.byteLength)).toEqual([40, 41, 42]);
    // header, the failed merged read, then three single reads.
    expect(asked).toHaveLength(5);
  });
});
