import { describe, it, expect } from "vitest";
import request from "supertest";

const API_URL = process.env.API_URL ?? "http://localhost:8080";
const EXPECTED_MIN_VERSION = process.env.MIN_MOBILE_VERSION ?? "0.0.0";

// The phone decides whether it is too old (mobile/src/useMinVersionGate.ts,
// compared in mobile/src/version.ts); the server's half is serving the
// deployed MIN_MOBILE_VERSION. CI sets it to a non-default value, so a server
// that ignored the override would answer "0.0.0" and fail here.
describe("MIN_MOBILE_VERSION reaches /meta", () => {
  it("GET /meta/min-mobile-version returns configured MIN_MOBILE_VERSION", async () => {
    const res = await request(API_URL)
      .get("/meta/min-mobile-version")
      .set("x-logjam-client", "mobile/0.1.0");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ minVersion: EXPECTED_MIN_VERSION });
  });

  it("GET /meta includes minMobileVersion matching environment", async () => {
    const res = await request(API_URL)
      .get("/meta")
      .set("x-logjam-client", "mobile/0.1.0");

    expect(res.status).toBe(200);
    expect(res.body.minMobileVersion).toBe(EXPECTED_MIN_VERSION);
    expect(res.body.sync).toBeDefined();
  });
});
