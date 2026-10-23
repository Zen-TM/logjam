import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  AREA_EXPORT_MAX_SIDE_KM,
  AREA_EXPORT_OUTSIDE_NSW,
  AREA_EXPORT_TOO_LARGE,
} from "@logjam/shared";
import { API_URL, BOB_SUB, as } from "./_actors";

// Requires `make dev` (Postgres + MiniStack + API on :8080, AUTH_MODE=fake).
// No auth header = alice. Launch-free surfaces only (auth, list + truncation
// header, validation, not-found) — a valid POST would spawn a MiniStack export
// worker, so it is intentionally not exercised.
const AUTH = { Authorization: "Bearer fake-token" } as const;

// Note: no unauthenticated-401 case — the integration suite runs only under
// AUTH_MODE=fake, where a request with no token defaults to the seeded alice
// (api/src/middleware/auth.ts). That path is unreachable here.
describe("topo-exports route (fake auth)", () => {
  it("lists exports and exposes the true total via X-Total-Count", async () => {
    const res = await request(API_URL).get("/topo-exports").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.exports)).toBe(true);
    const total = res.headers["x-total-count"];
    expect(total).toBeDefined();
    expect(Number.isNaN(Number(total))).toBe(false);
    // The header total is the pre-cap count, so it can never be below the page.
    expect(Number(total)).toBeGreaterThanOrEqual(res.body.exports.length);
  });

  it("rejects an invalid export request body", async () => {
    const res = await request(API_URL).post("/topo-exports").set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  // POST /topo-exports takes a source job the caller can READ, not only one
  // they own — a direct recipient can export a topo shared with them, charged
  // to their own quota. The widened OR must not become "any job at all", so
  // this pins the negative half: an id in neither arm is still 404, never a
  // 403 that would confirm it exists. (The positive half needs a completed
  // source job, whose POST would spawn a MiniStack export worker — the same
  // reason no valid POST is exercised in this file.)
  it("404s a source job the caller can neither own nor see", async () => {
    const body = {
      sourceJobIds: [randomUUID()],
      layers: ["hillshade"],
      format: "geotiff",
      bundling: "per-layer",
    };
    for (const actor of [AUTH, as(BOB_SUB)]) {
      const res = await request(API_URL)
        .post("/topo-exports")
        .set(actor)
        .send(body);
      expect(res.status).toBe(404);
    }
  });

  it("404s an unknown export id (get / delete)", async () => {
    const missing = randomUUID();
    const getRes = await request(API_URL)
      .get(`/topo-exports/${missing}`)
      .set(AUTH);
    expect(getRes.status).toBe(404);
    const delRes = await request(API_URL)
      .delete(`/topo-exports/${missing}`)
      .set(AUTH);
    expect(delRes.status).toBe(404);
  });

  // An export of an area is refused before anything is queued when it is too
  // large, outside the statewide terrain, or asks a GeoTIFF for contours.
  // Mutation: drop any one of the route's three checks, and that request
  // queues a worker that can only fail.
  describe("an export of an area", () => {
    // About 10 km square near Katoomba.
    const bbox = { west: 150.25, south: -33.75, east: 150.36, north: -33.66 };
    const post = (body: object) =>
      request(API_URL).post("/topo-exports").set(AUTH).send(body);

    it("refuses a box past the size limit", async () => {
      const degrees = (AREA_EXPORT_MAX_SIDE_KM + 5) / 110.57;
      const res = await post({
        bbox: { ...bbox, south: bbox.north - degrees },
        layers: ["heights"],
        format: "geotiff",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(AREA_EXPORT_TOO_LARGE);
    });

    it("refuses a box outside NSW", async () => {
      const res = await post({
        bbox: { ...bbox, west: 160.25, east: 160.36 },
        layers: ["heights"],
        format: "geotiff",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(AREA_EXPORT_OUTSIDE_NSW);
    });

    it("refuses contours in a GeoTIFF, and an unknown layer", async () => {
      expect(
        (await post({ bbox, layers: ["contours"], format: "geotiff" })).status,
      ).toBe(400);
      expect(
        (await post({ bbox, layers: ["vegetation"], format: "gpkg" })).status,
      ).toBe(400);
    });
  });
});
