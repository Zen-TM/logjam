import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { API_URL, as, BOB_SUB } from "./_actors";

// Requires `make dev`. No auth header = alice. Full CRUD is launch-free (no
// worker), so this covers the ownership boundary (a sharee/stranger must not
// reach another user's template — mandatory per CLAUDE.md), the synthetic
// read-only Default, validation, and not-found.
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("topo-templates route (fake auth)", () => {
  it("lists templates with the synthetic Default at the top", async () => {
    const res = await request(API_URL).get("/topo-templates").set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ id: "default", isSystem: true, name: "Default" });
  });

  it("serves the Default by id but refuses to mutate it", async () => {
    const getRes = await request(API_URL).get("/topo-templates/default").set(AUTH);
    expect(getRes.status).toBe(200);
    expect(getRes.body.isSystem).toBe(true);
    const patchRes = await request(API_URL)
      .patch("/topo-templates/default")
      .set(AUTH)
      .send({ name: "hijack" });
    expect(patchRes.status).toBe(400);
    const delRes = await request(API_URL).delete("/topo-templates/default").set(AUTH);
    expect(delRes.status).toBe(400);
  });

  it("rejects an invalid create", async () => {
    const noName = await request(API_URL)
      .post("/topo-templates")
      .set(AUTH)
      .send({ config: RASTER_TEMPLATE_DEFAULTS });
    expect(noName.status).toBe(400);
    const badConfig = await request(API_URL)
      .post("/topo-templates")
      .set(AUTH)
      .send({ name: "bad", config: { notARealSetting: true } });
    expect(badConfig.status).toBe(400);
  });

  it("404s an unknown template id", async () => {
    const missing = randomUUID();
    for (const m of ["get", "patch", "delete"] as const) {
      const res = await request(API_URL)[m](`/topo-templates/${missing}`).set(AUTH);
      expect(res.status).toBe(404);
    }
  });

  it("create → owner reads → stranger 404 on every verb → owner deletes", async () => {
    const createRes = await request(API_URL)
      .post("/topo-templates")
      .set(AUTH)
      .send({ name: "ch004-topo-template", config: RASTER_TEMPLATE_DEFAULTS });
    expect(createRes.status).toBe(201);
    const id: string = createRes.body.id;

    try {
      const ownRes = await request(API_URL).get(`/topo-templates/${id}`).set(AUTH);
      expect(ownRes.status).toBe(200);

      // A different user must not see or mutate alice's template — 404, not 403
      // (no oracle that the id exists).
      const bobGet = await request(API_URL).get(`/topo-templates/${id}`).set(as(BOB_SUB));
      expect(bobGet.status).toBe(404);
      const bobPatch = await request(API_URL)
        .patch(`/topo-templates/${id}`)
        .set(as(BOB_SUB))
        .send({ name: "stolen" });
      expect(bobPatch.status).toBe(404);
      const bobDel = await request(API_URL).delete(`/topo-templates/${id}`).set(as(BOB_SUB));
      expect(bobDel.status).toBe(404);
    } finally {
      const delRes = await request(API_URL).delete(`/topo-templates/${id}`).set(AUTH);
      expect(delRes.status).toBe(204);
    }

    const goneRes = await request(API_URL).get(`/topo-templates/${id}`).set(AUTH);
    expect(goneRes.status).toBe(404);
  });
});
