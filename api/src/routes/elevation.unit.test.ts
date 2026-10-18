import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getEnv() parses once and caches; these cases switch AUTH_MODE, so they read
// the live process.env.
vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
const dem = vi.hoisted(() => ({ heights: vi.fn(), slope: vi.fn() }));
vi.mock("../services/elevation", () => ({
  sampleElevations: dem.heights,
  sampleSlope: dem.slope,
}));

import { errorHandler } from "../middleware/errorHandler";
import elevationRouter from "./elevation";

const app = express();
app.use(express.json());
app.use("/elevation", elevationRouter);
app.use(errorHandler);

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
afterEach(() => {
  process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  dem.heights.mockReset();
  dem.slope.mockReset();
});

// Mutation: drop `requireAuth` from the route and the point is read for anyone
// who can name a coordinate (the integration suite runs under fake auth, where
// a missing header is alice, so it cannot see this).
describe("POST /elevation/point without a token", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "cognito";
  });

  it("401s and reads no DEM", async () => {
    const res = await request(app)
      .post("/elevation/point")
      .send({ point: [150.31, -33.7] });
    expect(res.status).toBe(401);
    expect(dem.heights).not.toHaveBeenCalled();
    expect(dem.slope).not.toHaveBeenCalled();
  });
});

describe("POST /elevation/point when the slope cannot be read", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "fake";
  });

  // Mutation: read the height and the slope with Promise.all, and a slope
  // window that reaches a tile the height never touched takes the height down
  // with it.
  it("still answers the height it read", async () => {
    dem.heights.mockResolvedValue({
      heights: [412.4],
      sourceIds: ["nsw-5m"],
      levelled: [412.4],
    });
    dem.slope.mockRejectedValue(new Error("DEM tile request failed"));
    const res = await request(app)
      .post("/elevation/point")
      .send({ point: [150.31, -33.7] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      elevationM: 412.4,
      slopeDegrees: null,
      demSourceIds: ["nsw-5m"],
    });
  });
});
