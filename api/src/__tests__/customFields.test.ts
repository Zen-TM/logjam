import { describe, it, expect } from "vitest";
import request from "supertest";
import { API_URL } from "./_actors";

// Requires `make dev`. No auth header = alice. Custom-field DEFINITIONS live in
// User.uiPreferences (managed via PATCH /users/me), so these routes only
// impact/delete an existing field key on the caller's own rows. Launch-free
// coverage of the requireFieldExists 404 guard + auth wiring for both entities.
// (The value-strip-on-delete logic is exercised by unit tests.)
const AUTH = { Authorization: "Bearer fake-token" } as const;

describe("custom-fields route (fake auth)", () => {
  it("404s impact for a field key the caller has not defined", async () => {
    const trip = await request(API_URL)
      .get("/custom-fields/trip-log/does-not-exist/impact")
      .set(AUTH);
    expect(trip.status).toBe(404);
    const canyon = await request(API_URL)
      .get("/custom-fields/canyon/does-not-exist/impact")
      .set(AUTH);
    expect(canyon.status).toBe(404);
  });

  it("404s delete for a field key the caller has not defined", async () => {
    const trip = await request(API_URL)
      .delete("/custom-fields/trip-log/does-not-exist")
      .set(AUTH);
    expect(trip.status).toBe(404);
    const canyon = await request(API_URL)
      .delete("/custom-fields/canyon/does-not-exist")
      .set(AUTH);
    expect(canyon.status).toBe(404);
  });
});
