// POST /places/search and the registry it reads, against the shared fixture
// served by a stubbed CDN. The ranking itself is shared/src/placeRegistry.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import express from "express";
import pinoHttp from "pino-http";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  indexPlaceRegistry,
  PLACE_REGISTRY_POINTER_PATH,
  placeRegistryUrl,
  searchPlaces,
  type PlaceRegistryPointer,
} from "@logjam/shared";
import { logger, serializeRequestForLog } from "../lib/logger";
import { errorHandler } from "../middleware/errorHandler";
import {
  clearPlaceRegistry,
  placeIndex,
  refreshPlaceRegistry,
  startPlaceRegistry,
} from "../services/placeRegistry";
import placeSearchRouter from "./placeSearch";

// Every log line the API would write, through the real redact paths: the
// privacy guard below reads them.
const lines = vi.hoisted(() => [] as string[]);
vi.mock("../lib/logger", async (original) => {
  const real = await original<typeof import("../lib/logger")>();
  const { default: pino } = await import("pino");
  return {
    ...real,
    logger: pino(
      { level: "debug", redact: { paths: real.redactPaths } },
      { write: (line: string) => void lines.push(line) },
    ),
  };
});
vi.mock("../lib/env", async (original) => {
  const real = await original<typeof import("../lib/env")>();
  return {
    ...real,
    getEnv: () => ({ ...real.getEnv(), TOPO_CDN_BASE_URL: "https://cdn.test" }),
  };
});

const FIXTURES = join(__dirname, "../../../shared/src/__fixtures__");
const FIXTURE = readFileSync(join(FIXTURES, "place-registry.json"));
/** The builder's pointer to the fixture. */
const POINTER: PlaceRegistryPointer = JSON.parse(
  readFileSync(join(FIXTURES, "place-registry-pointer.json"), "utf8"),
);
const POINTER_URL = `https://cdn.test/${PLACE_REGISTRY_POINTER_PATH}`;

/**
 * A CDN whose pointer names the fixture as `pointer`, or a file that fails.
 * The file arrives as fetch hands it over after Content-Encoding: gzip, or,
 * `undecoded`, as the gzipped bytes a server sends without that header.
 */
function serve(pointer = POINTER, fileStatus = 200, undecoded = false) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === POINTER_URL) return Response.json(pointer);
    if (url === placeRegistryUrl("https://cdn.test", pointer)) {
      return fileStatus === 200
        ? new Response(new Uint8Array(undecoded ? gzipSync(FIXTURE) : FIXTURE))
        : new Response(null, { status: fileStatus });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const NEXT_MONTH = {
  ...POINTER,
  version: "2026-11-01",
  path: "places-2026-11-01-89abcdef.json",
};

const app = express();
app.use(pinoHttp({ logger, serializers: { req: serializeRequestForLog } }));
app.use(express.json());
app.use("/places/search", placeSearchRouter);
app.use(errorHandler);

const search = (body: object) => request(app).post("/places/search").send(body);

beforeEach(() => {
  clearPlaceRegistry();
  lines.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("POST /places/search", () => {
  it("answers 503 with a sentence until a registry has loaded", async () => {
    const res = await search({ q: "katoomba" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Try again/);
  });

  it("answers from the registry the pointer names, with its version", async () => {
    serve();
    await refreshPlaceRegistry();
    const res = await search({ q: "  Katoomba Falls " });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("2026-10-01");
    expect(res.body.results[0]).toEqual({
      name: "Katoomba Falls",
      kind: "Waterfall",
      near: "Katoomba",
      lon: 150.307,
      lat: -33.73,
    });
  });

  // Mutation: drop the gzip magic check in readRegistryFile and this goes red.
  it("reads a file a server sent gzipped without saying so", async () => {
    serve(POINTER, 200, true);
    await refreshPlaceRegistry();
    expect((await search({ q: "katoomba" })).body.version).toBe(
      POINTER.version,
    );
  });

  it("honours the limit and refuses a query that is not text", async () => {
    serve();
    await refreshPlaceRegistry();
    expect((await search({ q: "ka", limit: 2 })).body.results).toHaveLength(2);
    // Nonsense gets the default, never an error.
    expect(
      (await search({ q: "ka", limit: "lots" })).body.results.length,
    ).toBeGreaterThan(2);
    expect((await search({ q: 42 })).status).toBe(400);
  });

  // ADR 0034's one ranking: the API answers exactly what searchPlaces does
  // over the same file, as Logjam GPS will on its own copy. Mutation: re-rank,
  // filter or reshape the results in the route and this goes red.
  it("answers exactly what searchPlaces answers over the fixture", async () => {
    serve();
    await refreshPlaceRegistry();
    const index = indexPlaceRegistry(JSON.parse(FIXTURE.toString("utf8")));
    for (const q of ["castle", "katoomba falls", "lookout", "station st"]) {
      const res = await search({ q, limit: 5 });
      expect(res.body.results, q).toEqual(searchPlaces(index, q, 5));
    }
  });

  it("keeps the registry it holds when a refresh fails, and swaps on a new build", async () => {
    serve();
    await refreshPlaceRegistry();

    serve(NEXT_MONTH, 500);
    await refreshPlaceRegistry();
    expect((await search({ q: "katoomba" })).body.version).toBe("2026-10-01");

    serve(NEXT_MONTH);
    await refreshPlaceRegistry();
    expect((await search({ q: "katoomba" })).body.version).toBe("2026-11-01");

    // The same build again reads only the pointer; a rebuild of the same
    // extract (same version, new hash) is read.
    const same = serve(NEXT_MONTH);
    await refreshPlaceRegistry();
    expect(same).toHaveBeenCalledOnce();
    const rebuilt = serve({
      ...NEXT_MONTH,
      path: "places-2026-11-01-0f0f0f0f.json",
    });
    await refreshPlaceRegistry();
    expect(rebuilt).toHaveBeenCalledTimes(2);
  });

  // A blip at boot must not mean five minutes of 503. Mutation: schedule the
  // retry at REFRESH_MS while nothing is held and this goes red.
  it("retries a failed first load within a minute, then refreshes slowly", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      serve(POINTER, 500);
      const stop = startPlaceRegistry();
      await vi.advanceTimersByTimeAsync(0);
      expect(placeIndex()).toBeNull();

      const fetchMock = serve();
      await vi.advanceTimersByTimeAsync(30_000);
      // The gunzip runs off the timers, on libuv's pool.
      await vi.waitFor(() =>
        expect(placeIndex()?.version).toBe(POINTER.version),
      );

      // Loaded: the pointer is read again only after five minutes.
      fetchMock.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(fetchMock).toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  // ROOT AGENTS.md PRIVACY: what the user typed never reaches a log line,
  // on an answer, a refusal, a body that is not JSON or a 503. Mutation: log
  // `req.body` (or `q`) in the route, put `q` in the `malformed` detail, or
  // drop the `entity.parse.failed` case from the error handler, and this goes
  // red.
  it("never logs the query", async () => {
    const query = "Hidden Gorge";
    await search({ q: query });
    serve();
    await refreshPlaceRegistry();
    await search({ q: query });
    await search({ q: query, limit: "lots" });
    await search({ q: [query] });
    // body-parser's own error quotes the text it could not parse.
    const broken = await request(app)
      .post("/places/search")
      .set("Content-Type", "application/json")
      .send(`{"q":${query}}`);
    expect(broken.status).toBe(400);
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) expect(line).not.toContain("Hidden");
  });
});
