import { describe, expect, it } from "vitest";
import type { TopoJob } from "../../dialogs/TopoDialog";
import { fileSubtitle, toposBeingMade } from "./mapsModel";

const topo = (overrides: Partial<TopoJob>): TopoJob => ({
  id: "t",
  status: "processing",
  name: "Claustral",
  footprint: null,
  tileCount: 2,
  estimatedSeconds: null,
  layerOptions: null,
  errorMessage: null,
  createdAt: "2026-09-10T05:00:00.000Z",
  updatedAt: "2026-09-10T05:00:00.000Z",
  syncRole: "owner",
  ...overrides,
});

describe("what the Sharpened areas view is still making", () => {
  it("lists topos still on their way, newest first", () => {
    const items = toposBeingMade([
      topo({
        id: "old",
        createdAt: "2026-09-01T00:00:00.000Z",
        status: "pending",
      }),
      topo({
        id: "new",
        createdAt: "2026-09-09T00:00:00.000Z",
        estimatedSeconds: 1260,
      }),
    ]);
    expect(
      items.map((item) => [item.kind, item.id, item.title, item.detail]),
    ).toEqual([
      ["topo", "new", "Claustral", "Processing · about 21 min"],
      ["topo", "old", "Claustral", "Queued"],
    ]);
  });

  it("says a failure in the worker's words, or plainly when it gave none", () => {
    const [failed] = toposBeingMade([topo({ status: "failed" })]);
    expect(failed).toMatchObject({ failed: true, detail: "Couldn't be made" });
  });
});

describe("what a finished map says about itself", () => {
  it("gives a file's size in the phone's words, and leaves out what it does not know", () => {
    expect(
      fileSubtitle({
        format: "GeoTIFF",
        bytes: 124_000_000,
        createdAt: "2026-09-10T05:00:00.000Z",
      }),
    ).toMatch(/^GeoTIFF · 118 MB · .*2026$/);
    expect(
      fileSubtitle({ bytes: null, createdAt: "2026-09-10T05:00:00.000Z" }),
    ).not.toContain("MB");
  });
});
