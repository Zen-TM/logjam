import { describe, it, expect } from "vitest";
import request from "supertest";
import { MAX_ROUTE_POINTS } from "@logjam/shared";
import { API_URL, as, ALICE_SUB } from "./_actors";

// Validation paths only. A valid line makes the route fetch DEM tiles from the
// public tile host (services/elevation.ts), and the suite must not reach an
// external host, so the 200 path is not driven here.
const AUTH = as(ALICE_SUB);

/** n distinct in-bounds [lon, lat] points. */
function line(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => [150 + i * 1e-5, -33 - i * 1e-5]);
}

function post(body: unknown) {
  return request(API_URL)
    .post("/elevation/profile")
    .set(AUTH)
    .send(body as object);
}

describe("POST /elevation/profile — validation", () => {
  it("400s points over MAX_ROUTE_POINTS", async () => {
    expect((await post({ points: line(MAX_ROUTE_POINTS + 1) })).status).toBe(
      400,
    );
  });

  it("400s a missing or empty body", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ points: [] })).status).toBe(400);
  });

  it("400s an empty segments list and an empty inner segment", async () => {
    expect((await post({ segments: [] })).status).toBe(400);
    expect((await post({ segments: [line(3), []] })).status).toBe(400);
  });

  it("400s when the vertices across segments exceed the cap", async () => {
    // Each segment is under the cap on its own; only the total is over.
    const half = Math.floor(MAX_ROUTE_POINTS / 2) + 1;
    const res = await post({ segments: [line(half), line(half)] });
    expect(res.status).toBe(400);
  });
});
