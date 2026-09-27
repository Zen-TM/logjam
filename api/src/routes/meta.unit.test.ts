import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import metaRouter from "./meta";
import { getEnv } from "../lib/env";

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
});
