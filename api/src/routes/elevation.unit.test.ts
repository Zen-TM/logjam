import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getEnv() parses once and caches; this file needs cognito mode, where a
// request with no token is refused.
vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
const sample = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../services/elevation", () => ({
  sampleElevations: sample.read,
  sampleSlope: sample.read,
}));

import { errorHandler } from "../middleware/errorHandler";
import elevationRouter from "./elevation";

const app = express();
app.use(express.json());
app.use("/elevation", elevationRouter);
app.use(errorHandler);

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
beforeEach(() => {
  process.env.AUTH_MODE = "cognito";
});
afterEach(() => {
  process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  sample.read.mockReset();
});

// Mutation: drop `requireAuth` from the route and the point is read for anyone
// who can name a coordinate (the integration suite runs under fake auth, where
// a missing header is alice, so it cannot see this).
describe("POST /elevation/point without a token", () => {
  it("401s and reads no DEM", async () => {
    const res = await request(app)
      .post("/elevation/point")
      .send({ point: [150.31, -33.7] });
    expect(res.status).toBe(401);
    expect(sample.read).not.toHaveBeenCalled();
  });
});
