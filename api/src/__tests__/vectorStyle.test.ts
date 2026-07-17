import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL } from "./_actors";

// Requires `make dev`. No auth header = alice. The vector style is a per-user
// singleton (no id, no cross-user surface), so this covers the fetch, the
// validator wiring on PUT, and a full round-trip.
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("vector-style route (fake auth)", () => {
  it("returns the caller's style (defaults if unset)", async () => {
    const res = await request(API_URL).get("/vector-style").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toBeTypeOf("object");
    expect(res.body).not.toBeNull();
  });

  it("rejects an invalid style", async () => {
    const res = await request(API_URL)
      .put("/vector-style")
      .set(AUTH)
      .send({ not: "a valid vector style" });
    expect(res.status).toBe(400);
  });

  it("round-trips a valid style (the current one is valid by construction)", async () => {
    const current = await request(API_URL).get("/vector-style").set(AUTH);
    expect(current.status).toBe(200);
    const putRes = await request(API_URL).put("/vector-style").set(AUTH).send(current.body);
    expect(putRes.status).toBe(200);
    // PUT echoes the stored style back.
    expect(putRes.body).toBeTypeOf("object");
    const after = await request(API_URL).get("/vector-style").set(AUTH);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(putRes.body);
  });
});
