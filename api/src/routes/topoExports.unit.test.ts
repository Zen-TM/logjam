import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lat2tileY, lon2tileX, type SharpenedArea } from "@logjam/shared";

vi.mock("../lib/env", () => ({ getEnv: () => process.env }));
vi.mock("../lib/resolveUser", () => ({
  resolveUser: async () => ({
    id: "user-1",
    uiPreferences: null,
    monthlyComputeCredits: 100,
  }),
}));
const launch = vi.hoisted(() => vi.fn());
vi.mock("../lib/topoExportLauncher", () => ({
  createAndLaunchTopoExport: launch,
}));
const visible = vi.hoisted(() => vi.fn());
vi.mock("../services/sharpenedAreas", () => ({
  visibleSharpenedAreas: visible,
}));

import { errorHandler } from "../middleware/errorHandler";
import topoExportsRouter from "./topoExports";

const app = express();
app.use(express.json());
app.use("/topo-exports", topoExportsRouter);
app.use(errorHandler);

// A box near Katoomba, and areas whose z15 range holds it or lies far off.
const BOX = { west: 150.3, south: -33.71, east: 150.31, north: -33.7 };
const x = lon2tileX(BOX.west, 15);
const y = lat2tileY(BOX.north, 15);
const area = (id: string, over: Partial<SharpenedArea> = {}) => ({
  id,
  zmax: 16,
  tiles15: [x - 1, y - 1, x + 2, y + 2],
  coverage: [150.29, -33.72, 150.32, -33.69],
  contours: true,
  credit: "Elevation: derived from a LiDAR survey.",
  createdAt: "2026-10-20T00:00:00.000Z",
  keys: { heights: "h", slope: "s", contours: "c" },
  ...over,
});

const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
beforeEach(() => {
  process.env.AUTH_MODE = "fake";
  launch.mockResolvedValue("export-1");
});
afterEach(() => {
  process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  launch.mockReset();
  visible.mockReset();
});

describe("POST /topo-exports and sharpened areas", () => {
  // The worker reads only the areas named here, so this is the boundary:
  // only those the caller may read (visibleSharpenedAreas, whose owner,
  // sharee, stranger and revoked cases are api/src/__tests__/
  // sharpenedAreas.test.ts), only those in the box, in the router's order.
  // Mutations: name every completed area (or none), drop the box filter, or
  // drop the order.
  it("names the caller's readable areas in the box, finest first", async () => {
    visible.mockResolvedValue([
      area("coarse"),
      area("far", { tiles15: [x + 50, y + 50, x + 51, y + 51] }),
      area("fine", { zmax: 17 }),
    ]);
    const res = await request(app)
      .post("/topo-exports")
      .send({ bbox: BOX, layers: ["heights"], format: "geotiff" });
    expect(res.status).toBe(201);
    expect(visible).toHaveBeenCalledWith("user-1");
    expect(launch.mock.calls[0]![0].sourceJobIds).toEqual(["fine", "coarse"]);
  });
});
