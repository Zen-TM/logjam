import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { API_URL, as, BOB_SUB } from "./_actors";

// Requires `make dev`. No auth header = alice. Launch-free CRUD covering the
// ownership boundary (a stranger must not reach another user's template —
// mandatory per CLAUDE.md), validation, and not-found.
const AUTH = { Authorization: "Bearer fake-token" } as const;

// A fully valid GeoPDF template config (mirrors shared/src/geoPdfConfig.test.ts
// validConfig()). Templates may omit extent, but a full one is also valid.
const VALID_CONFIG = {
  paperSize: "A4",
  orientation: "portrait",
  scale: 25000,
  baseLayer: "osm",
  overlays: ["hillshade", "contours"],
  elements: { compass: true, scaleText: true, scaleBar: true },
} as const;

describe("geo-pdf-templates route (fake auth)", () => {
  it("lists the caller's templates", async () => {
    const res = await request(API_URL).get("/geo-pdf-templates").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("rejects an invalid create", async () => {
    const noName = await request(API_URL)
      .post("/geo-pdf-templates")
      .set(AUTH)
      .send({ config: VALID_CONFIG });
    expect(noName.status).toBe(400);
    const noConfig = await request(API_URL)
      .post("/geo-pdf-templates")
      .set(AUTH)
      .send({ name: "no config" });
    expect(noConfig.status).toBe(400);
    const badLayer = await request(API_URL)
      .post("/geo-pdf-templates")
      .set(AUTH)
      .send({ name: "bad layer", config: { ...VALID_CONFIG, baseLayer: "evil-tiles" } });
    expect(badLayer.status).toBe(400);
  });

  it("404s an unknown template id", async () => {
    const missing = randomUUID();
    for (const m of ["get", "patch", "delete"] as const) {
      const res = await request(API_URL)[m](`/geo-pdf-templates/${missing}`).set(AUTH);
      expect(res.status).toBe(404);
    }
  });

  it("create → owner reads → stranger 404 on every verb → owner deletes", async () => {
    const createRes = await request(API_URL)
      .post("/geo-pdf-templates")
      .set(AUTH)
      .send({ name: "ch004-geopdf-template", config: VALID_CONFIG });
    expect(createRes.status).toBe(201);
    const id: string = createRes.body.id;

    try {
      const ownRes = await request(API_URL).get(`/geo-pdf-templates/${id}`).set(AUTH);
      expect(ownRes.status).toBe(200);

      const bobGet = await request(API_URL).get(`/geo-pdf-templates/${id}`).set(as(BOB_SUB));
      expect(bobGet.status).toBe(404);
      const bobPatch = await request(API_URL)
        .patch(`/geo-pdf-templates/${id}`)
        .set(as(BOB_SUB))
        .send({ name: "stolen" });
      expect(bobPatch.status).toBe(404);
      const bobDel = await request(API_URL).delete(`/geo-pdf-templates/${id}`).set(as(BOB_SUB));
      expect(bobDel.status).toBe(404);
    } finally {
      const delRes = await request(API_URL).delete(`/geo-pdf-templates/${id}`).set(AUTH);
      expect(delRes.status).toBe(204);
    }

    const goneRes = await request(API_URL).get(`/geo-pdf-templates/${id}`).set(AUTH);
    expect(goneRes.status).toBe(404);
  });
});
