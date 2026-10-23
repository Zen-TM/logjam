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
const visible = vi.hoisted(() => vi.fn());
vi.mock("../lib/resolveUser", () => ({
  resolveUser: async () => ({ id: "user-1" }),
}));
vi.mock("../services/sharpenedAreas", () => ({
  visibleSharpenedAreas: visible,
}));

import { errorHandler } from "../middleware/errorHandler";
import elevationRouter from "./elevation";

const app = express();
app.use(express.json());
app.use("/elevation", elevationRouter);
app.use(errorHandler);

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
beforeEach(() => {
  visible.mockResolvedValue([]);
});
afterEach(() => {
  process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  dem.heights.mockReset();
  dem.slope.mockReset();
  visible.mockReset();
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

describe("POST /elevation/point inside a sharpened area", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "fake";
  });

  // Mutations: sample without the caller's areas (their finer heights never
  // answer), or credit from the public sources alone (the survey's credit,
  // which its licence asks for, is dropped).
  it("reads the areas the caller may see, and credits the survey", async () => {
    const area = {
      id: "job-1",
      zmax: 17,
      tiles15: [0, 0, 1, 1],
      coverage: [150.3, -33.8, 150.4, -33.7],
      contours: true,
      credit: "Elevation: derived from a LiDAR survey.",
      createdAt: "2026-10-24T00:00:00.000Z",
      keys: { heights: "h", slope: "s", contours: "c" },
    };
    visible.mockResolvedValue([area]);
    dem.heights.mockResolvedValue({
      heights: [412.4],
      sourceIds: ["lidar-job-1"],
      levelled: [412.4],
    });
    dem.slope.mockResolvedValue({ slopeDegrees: 31, sourceId: "lidar-job-1" });
    const res = await request(app)
      .post("/elevation/point")
      .send({ point: [150.31, -33.75] });
    expect(res.status).toBe(200);
    expect(visible).toHaveBeenCalledWith("user-1");
    expect(dem.heights.mock.calls[0]![1]).toEqual([area]);
    expect(dem.slope.mock.calls[0]![2]).toEqual([area]);
    expect(res.body.demSourceIds).toEqual(["lidar-job-1"]);
    expect(res.body.attribution).toContain(area.credit);
    expect(res.body.attribution).toContain("NSW 5 m");
  });
});
