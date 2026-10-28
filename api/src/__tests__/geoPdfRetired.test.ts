import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL, as, BOB_SUB } from "./_actors";

// Requires `make dev` (AUTH_MODE=fake). Mutation: delete the router mount in
// src/index.ts and the list answers 404.
describe("GET /geo-pdf — retired, kept for Logjam GPS builds that still ask", () => {
  it("answers an empty list", async () => {
    const res = await request(API_URL).get("/geo-pdf").set(as(BOB_SUB));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ jobs: [] });
  });

  it("holds no job to fetch or create", async () => {
    const one = await request(API_URL)
      .get("/geo-pdf/00000000-0000-4000-8000-000000000000")
      .set(as(BOB_SUB));
    expect(one.status).toBe(404);
    const made = await request(API_URL)
      .post("/geo-pdf")
      .set(as(BOB_SUB))
      .send({});
    expect(made.status).toBe(404);
  });
});
