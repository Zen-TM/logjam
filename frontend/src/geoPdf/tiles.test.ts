import { afterEach, describe, expect, it, vi } from "vitest";
import { geoPdfFileName } from "./client";
import {
  fetchBytes,
  hostClassOf,
  HOST_LIMITS,
  limitFor,
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
