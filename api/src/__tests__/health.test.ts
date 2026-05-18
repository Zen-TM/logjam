import { describe, it, expect } from "vitest";
import request from "supertest";

// Requires `make dev` to be running (Postgres + API container on :8080).
const API_URL = process.env.API_URL ?? "http://localhost:8080";

describe("API smoke tests (fake auth)", () => {
  it("GET /health returns 200", async () => {
    const res = await request(API_URL).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /users/me returns alice in fake-auth mode", async () => {
    const res = await request(API_URL)
      .get("/users/me")
      .set("Authorization", "Bearer fake-token");
    expect(res.status).toBe(200);
    expect(res.body.username).toBe("alice");
  });

  it("GET /canyons returns alice's canyons", async () => {
    const res = await request(API_URL)
      .get("/canyons")
      .set("Authorization", "Bearer fake-token");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
