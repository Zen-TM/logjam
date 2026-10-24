import { describe, expect, it } from "vitest";
import type { GeoPdfJobView, TopoExportJobView } from "@logjam/shared";
import type { TopoJob } from "../../dialogs/TopoDialog";
import {
  exportLabel,
  exportsBeingMade,
  fileSubtitle,
  geoPdfLabel,
  geoPdfsBeingMade,
  isOlderLidarJob,
  offersTemplates,
  toposBeingMade,
} from "./mapsModel";

const geoPdf = (overrides: Partial<GeoPdfJobView>): GeoPdfJobView => ({
  id: "g",
  status: "completed",
  title: null,
  estimatedSeconds: null,
  resultBytes: null,
  errorMessage: null,
  createdAt: "2026-09-10T05:00:00.000Z",
  completedAt: null,
  downloadUrl: null,
  downloadExpiresAt: null,
  syncRole: "owner",
  ...overrides,
});

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

const topoExport = (
  overrides: Partial<TopoExportJobView>,
): TopoExportJobView => ({
  id: "e",
  sourceJobIds: ["t1"],
  bbox: null,
  layers: ["contours"],
  format: "gpkg",
  bundling: "composite",
  status: "running",
  estimatedSeconds: null,
  resultBytes: null,
  errorMessage: null,
  createdAt: "2026-09-10T05:00:00.000Z",
  completedAt: null,
  downloadUrl: null,
  downloadExpiresAt: null,
  ...overrides,
});

describe("what the Maps page is still making", () => {
  it("leaves finished GeoPDFs out, and says where each of the rest has got to", () => {
    const items = geoPdfsBeingMade([
      geoPdf({ id: "done" }),
      geoPdf({ id: "queued", status: "queued", title: "Grose" }),
      geoPdf({ id: "running", status: "running", estimatedSeconds: 300 }),
      geoPdf({
        id: "failed",
        status: "failed",
        errorMessage: "Failed to launch GeoPDF job.",
      }),
    ]);
    expect(items.map((item) => [item.id, item.detail, item.failed])).toEqual([
      ["queued", "Queued", false],
      ["running", "Making · about 5 min", false],
      ["failed", "Failed to launch GeoPDF job.", true],
    ]);
  });

  // A row made before the estimator existed has no number to quote, and a
  // zero is not an estimate.
  it("quotes no time it does not have", () => {
    const [unknown, zero] = geoPdfsBeingMade([
      geoPdf({ status: "running" }),
      geoPdf({ status: "running", estimatedSeconds: 0 }),
    ]);
    expect(unknown.detail).toBe("Making");
    expect(zero.detail).toBe("Making");
  });

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

  it("lists exports still on their way, and not the finished ones", () => {
    const items = exportsBeingMade(
      [
        topoExport({
          id: "mid",
          createdAt: "2026-09-05T00:00:00.000Z",
          status: "queued",
        }),
        topoExport({ id: "finished", status: "completed" }),
      ],
      new Map([["t1", "Wollangambe"]]),
    );
    expect(
      items.map((item) => [item.kind, item.id, item.title, item.detail]),
    ).toEqual([
      ["export", "mid", "Wollangambe", "Export as GeoPackage · Queued"],
    ]);
  });

  it("says a failure in the worker's words, or plainly when it gave none", () => {
    const [failed] = toposBeingMade([topo({ status: "failed" })]);
    expect(failed).toMatchObject({ failed: true, detail: "Couldn't be made" });
  });
});

describe("what a finished map is called", () => {
  it("names an untitled GeoPDF by when it was made, to the minute", () => {
    expect(geoPdfLabel(geoPdf({ title: "Wollangambe 1:25k" }))).toBe(
      "Wollangambe 1:25k",
    );
    expect(geoPdfLabel(geoPdf({}))).toMatch(/^GeoPDF · .*2026.*\d:\d\d/);
  });

  // The source topo is deletable; its exports outlive it for their 7 days.
  it("names an export after its topo, even once the topo is gone", () => {
    expect(
      exportLabel(
        { sourceJobIds: ["t1"], bbox: null },
        new Map([["t1", "Wollangambe"]]),
      ),
    ).toBe("Wollangambe");
    expect(exportLabel({ sourceJobIds: ["gone"], bbox: null }, new Map())).toBe(
      "Deleted topo",
    );
  });

  // Mutation: drop the bbox branch, and every area export reads "Deleted topo".
  it("names an export of an area by the ground it covers", () => {
    expect(
      exportLabel(
        {
          sourceJobIds: [],
          bbox: { west: 150.2, south: -33.7, east: 150.3, north: -33.6 },
        },
        new Map(),
      ),
    ).toBe("Area of 9.3 km × 11.1 km");
  });

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

describe("an older LiDAR job", () => {
  // Mutations: mark the sharpened jobs instead, or mark the old ones before
  // new jobs sharpen, when every job is of the old kind.
  it("is marked once new jobs sharpen, and only if it has no area", () => {
    const area = { sharpened: {} } as Parameters<typeof isOlderLidarJob>[0];
    expect(isOlderLidarJob({}, true)).toBe(true);
    expect(isOlderLidarJob(area, true)).toBe(false);
    expect(isOlderLidarJob({}, false)).toBe(false);
  });
});

describe("what the LiDAR list offers", () => {
  // Mutation: keep the template entries with the switch on, and a template
  // row starts a sharpened job with settings it can't use.
  it("offers templates only while new jobs don't sharpen", () => {
    expect(offersTemplates(true)).toBe(false);
    expect(offersTemplates(false)).toBe(true);
  });
});
