import { describe, expect, it } from "vitest";
import type { GeoPdfJobView } from "@logjam/shared";
import type { TopoJob } from "../../dialogs/TopoDialog";
import {
  fileSubtitle,
  geoPdfLabel,
  geoPdfsBeingMade,
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
