import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import metaRouter from "./meta";
import { getEnv } from "../lib/env";

// Before getEnv() first runs and caches: the image bakes GIT_SHA in.
const SHA = vi.hoisted(() => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  process.env.GIT_SHA = sha;
  return sha;
});

const app = express();
app.use("/meta", metaRouter);

describe("GET /meta endpoints (min-version gate lever)", () => {
  it("GET /meta/min-mobile-version returns configured MIN_MOBILE_VERSION", async () => {
    const res = await request(app)
      .get("/meta/min-mobile-version")
      .set("x-logjam-client", "mobile/0.1.0");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ minVersion: getEnv().MIN_MOBILE_VERSION });
  });

  it("GET /meta returns minMobileVersion matching getEnv()", async () => {
    const res = await request(app)
      .get("/meta")
      .set("x-logjam-client", "mobile/0.1.0");

    expect(res.status).toBe(200);
    expect(res.body.minMobileVersion).toBe(getEnv().MIN_MOBILE_VERSION);
    expect(res.body.sync).toBeDefined();
    expect(Array.isArray(res.body.sync.protocols)).toBe(true);
  });

  // The deploy and rollback smoke steps fail unless this is the sha they
  // shipped. Red if the field is removed or stops reading GIT_SHA.
  it("GET /meta reports the commit the image was built from", async () => {
    const res = await request(app).get("/meta");

    expect(res.status).toBe(200);
    expect(res.body.sha).toBe(SHA);
  });
});
