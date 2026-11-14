// POST /places/search and the registries it reads, against the shared fixture
// served by a stubbed CDN. The ranking itself is shared/src/placeRegistry.test.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import express from "express";
import pinoHttp from "pino-http";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REGION_IDS,
  indexPlaceRegistry,
  NSW_REGION,
  PLACE_REGISTRY_POINTER_PATH,
  PLACE_REGISTRY_PREFIX,
  placeRegistryPointerPath,
  placeRegistryUrl,
  searchPlaces,
  type PlaceRegistryFile,
  type PlaceRegistryPointer,
  type Region,
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
// A second region with a registry of its own, beside NSW's, as the dev stack
// has once a simulated region publishes one, and one that declares none, as a
// simulated region does today.
const { OTHER, BARE } = vi.hoisted(() => {
  const other = {
    id: "other",
    placeSearch: "master/places/other/v1/",
  } as unknown as Region;
  return { OTHER: other, BARE: { ...other, id: "bare", placeSearch: null } };
});
vi.mock("@logjam/shared", async (original) => {
  const real = await original<typeof import("@logjam/shared")>();
  Object.assign(OTHER, { ...real.NSW_REGION, ...OTHER });
  Object.assign(BARE, { ...real.NSW_REGION, ...BARE });
  return { ...real, REGIONS: [...real.REGIONS, OTHER, BARE] };
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
const NSW = DEFAULT_REGION_IDS[0];

/** The other region's registry: two places that NSW's does not hold. */
const OTHER_FILE: PlaceRegistryFile = {
  format: 1,
  version: "2026-10-02",
  attribution: "© OpenStreetMap contributors",
  licence: "ODbL-1.0",
  coordScale: 1e5,
  kinds: ["natural=peak", "waterway=waterfall"],
  names: ["Makarora Peak", "Haast Falls"],
  kind: [0, 1],
  lon: [16_920_000, 16_930_000],
  lat: [-4_410_000, -4_405_000],
  near: [-1, -1],
  alternates: [],
};
const OTHER_BYTES = Buffer.from(JSON.stringify(OTHER_FILE));
const OTHER_POINTER: PlaceRegistryPointer = {
  format: 1,
  version: OTHER_FILE.version,
  path: "places-2026-10-02-4567cdef.json",
  bytes: 1000,
};

/**
 * A CDN whose pointer names the fixture as `pointer`, or a file that fails.
 * The file arrives as fetch hands it over after Content-Encoding: gzip, or,
 * `undecoded`, as the gzipped bytes a server sends without that header.
 * `other` serves the other region's registry under its own prefix.
 */
function serve(
  pointer = POINTER,
  fileStatus = 200,
  undecoded = false,
  other: "served" | "failing" | "absent" = "absent",
) {
  const otherPointerUrl = `https://cdn.test/${placeRegistryPointerPath(OTHER.placeSearch!)}`;
  const fetchMock = vi.fn(async (url: string) => {
    if (url === POINTER_URL) return Response.json(pointer);
    if (
      url ===
      placeRegistryUrl("https://cdn.test", PLACE_REGISTRY_PREFIX, pointer)
    ) {
      return fileStatus === 200
        ? new Response(new Uint8Array(undecoded ? gzipSync(FIXTURE) : FIXTURE))
        : new Response(null, { status: fileStatus });
    }
    if (url === otherPointerUrl && other !== "absent") {
      return Response.json(OTHER_POINTER);
    }
    if (
      url ===
      placeRegistryUrl("https://cdn.test", OTHER.placeSearch!, OTHER_POINTER)
    ) {
      return other === "served"
        ? new Response(new Uint8Array(OTHER_BYTES))
        : new Response(null, { status: 500 });
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

  // Mutation: read `PLACE_REGISTRY_PREFIX` or the first region's index in the
  // route, whatever `region` says, and the other region's search answers with
  // NSW's places (or the reverse).
  it("answers from the registry of the region it names, and the default region's when it names none", async () => {
    serve(POINTER, 200, false, "served");
    await refreshPlaceRegistry();
    const other = await search({ q: "makarora", region: OTHER.id });
    expect(other.status).toBe(200);
    expect(other.body.version).toBe(OTHER_POINTER.version);
    expect(other.body.results.map((r: { name: string }) => r.name)).toEqual([
      "Makarora Peak",
    ]);
    // NSW's places are not in the other region's, nor its in NSW's.
    expect(
      (await search({ q: "katoomba", region: OTHER.id })).body.results,
    ).toEqual([]);
    expect((await search({ q: "makarora", region: NSW })).body.results).toEqual(
      [],
    );
    const unnamed = await search({ q: "katoomba" });
    expect(unnamed.body.version).toBe(POINTER.version);
    expect(unnamed.body.results[0].name).toBe("Katoomba");
  });

  // Mutation: look the region up in the route by `REGIONS.find` on its id,
  // without `regionWithRegistry`, and a region with no registry answers 503
  // "try again" for something that will never load.
  it("refuses a region that is unknown, has no registry, or is not text", async () => {
    serve(POINTER, 200, false, "served");
    await refreshPlaceRegistry();
    for (const region of ["nowhere", BARE.id, 7, ["other"], {}]) {
      const res = await search({ q: "katoomba", region });
      expect(res.status, JSON.stringify(region)).toBe(400);
    }
  });

  // Mutation: load only the first region in `refreshPlaceRegistry`, or rethrow
  // in `refreshRegion`'s catch, and one region's failure ends the refresh.
  it("loads each region's registry from its own prefix, and one failing leaves the others", async () => {
    serve(POINTER, 200, false, "failing");
    await refreshPlaceRegistry();
    expect((await search({ q: "katoomba" })).status).toBe(200);
    expect((await search({ q: "makarora", region: OTHER.id })).status).toBe(
      503,
    );

    const fetchMock = serve(POINTER, 200, false, "served");
    await refreshPlaceRegistry();
    expect(
      (await search({ q: "makarora", region: OTHER.id })).body.results,
    ).toHaveLength(1);
    // NSW's build was already held: only its pointer was read again.
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      placeRegistryUrl("https://cdn.test", PLACE_REGISTRY_PREFIX, POINTER),
    );
  });

  // Mutation: schedule the retry from "something is held" and not "every
  // region is held", and a region that failed to load waits five minutes.
  it("retries within a minute while any region has not loaded", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      serve(POINTER, 200, false, "failing");
      const stop = startPlaceRegistry();
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(placeIndex(NSW)).not.toBeNull());
      expect(placeIndex(OTHER.id)).toBeNull();

      serve(POINTER, 200, false, "served");
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(() => expect(placeIndex(OTHER.id)).not.toBeNull());
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the registry it holds when a refresh fails, and swaps on a new build", async () => {
    // NSW's alone: what is counted below is its pointer and its file.
    serve();
    await refreshPlaceRegistry([NSW_REGION]);

    serve(NEXT_MONTH, 500);
    await refreshPlaceRegistry([NSW_REGION]);
    expect((await search({ q: "katoomba" })).body.version).toBe("2026-10-01");

    serve(NEXT_MONTH);
    await refreshPlaceRegistry([NSW_REGION]);
    expect((await search({ q: "katoomba" })).body.version).toBe("2026-11-01");

    // The same build again reads only the pointer; a rebuild of the same
    // extract (same version, new hash) is read.
    const same = serve(NEXT_MONTH);
    await refreshPlaceRegistry([NSW_REGION]);
    expect(same).toHaveBeenCalledOnce();
    const rebuilt = serve({
      ...NEXT_MONTH,
      path: "places-2026-11-01-0f0f0f0f.json",
    });
    await refreshPlaceRegistry([NSW_REGION]);
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
      expect(placeIndex(NSW)).toBeNull();

      const fetchMock = serve(POINTER, 200, false, "served");
      await vi.advanceTimersByTimeAsync(30_000);
      // The gunzip runs off the timers, on libuv's pool.
      await vi.waitFor(() =>
        expect(placeIndex(OTHER.id)?.version).toBe(OTHER_POINTER.version),
      );
      expect(placeIndex(NSW)?.version).toBe(POINTER.version);

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
  // `req.body` (or `q`) in the route, put `q` in the `malformed` detail (the
  // region refusals too), or drop the `entity.parse.failed` case from the
  // error handler, and this goes red.
  it("never logs the query", async () => {
    const query = "Hidden Gorge";
    await search({ q: query });
    serve();
    await refreshPlaceRegistry();
    await search({ q: query });
    await search({ q: query, limit: "lots" });
    await search({ q: [query] });
    await search({ q: query, region: "nowhere" });
    await search({ q: query, region: 7 });
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
