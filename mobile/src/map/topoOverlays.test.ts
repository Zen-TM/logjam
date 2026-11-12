import { describe, it, expect } from "vitest";
import { TOPO_LAYERS, lidarJobSharePromise } from "@logjam/shared";
import {
  composeTopoOverlayRefs,
  mergeSavedOverlayJobs,
  topoOverlayCredits,
  type CompletedOverlaysResponse,
} from "./topoOverlays";
import type { MapArtifact } from "./sourceResolver";

const LAYER_ORDER = TOPO_LAYERS.map((l) => l.name);

function savedOverlay(jobId: string, layer: string): MapArtifact {
  const format = TOPO_LAYERS.find((l) => l.name === layer)!.format;
  return {
    id: `art-${jobId}-${layer}`,
    kind: "topo-overlay",
    logicalKey: `${jobId}/${layer}`,
    format: "pmtiles",
    sourceType: format,
    path: `/data/${jobId}.pmtiles`,
    bbox: null,
    minzoom: null,
    maxzoom: null,
    sizeBytes: 1234,
    downloadedAt: "2026-07-22T00:00:00Z",
  };
}

function response(): CompletedOverlaysResponse {
  const layer = (name: "hillshade" | "vegetation", pmtilesUrl: string) => ({
    name,
    format: TOPO_LAYERS.find((l) => l.name === name)!.format,
    pmtilesUrl,
  });
  return {
    expiresAt: "2026-07-24T00:00:00Z",
    jobs: [
      {
        jobId: "old",
        name: "Old job",
        createdAt: "2026-07-01T00:00:00Z",
        layers: [
          layer("hillshade", "https://s3/old-a"),
          layer("vegetation", "https://s3/old-b"),
        ],
      },
      {
        jobId: "new",
        name: "New job",
        createdAt: "2026-07-20T00:00:00Z",
        layers: [layer("vegetation", "https://s3/new-b")],
      },
    ],
  };
}

describe("composeTopoOverlayRefs", () => {
  // Mutation: compose every layer of a job and the retired hillshade overlay
  // draws again over the Terrain group's own.
  it("draws vegetation only, newest job first, with its presigned URL and credit", () => {
    const refs = composeTopoOverlayRefs(response());
    expect(refs.map((r) => `${r.jobId}/${r.layer}`)).toEqual([
      "new/vegetation",
      "old/vegetation",
    ]);
    expect(refs[0].remoteUrl).toBe("https://s3/new-b");
    expect(refs[0].attribution).toBeTruthy();
  });

  it("draws nothing for an area with no vegetation layer", () => {
    const online = response();
    online.jobs = online.jobs.map((job) => ({
      ...job,
      layers: job.layers.filter((l) => l.name !== "vegetation"),
    }));
    expect(composeTopoOverlayRefs(online)).toEqual([]);
  });
});

describe("mergeSavedOverlayJobs", () => {
  it("synthesizes a job from a saved artifact when the online list is empty", () => {
    const merged = mergeSavedOverlayJobs(null, [
      savedOverlay("saved", LAYER_ORDER[0]),
    ]);
    expect(merged.jobs).toHaveLength(1);
    expect(merged.jobs[0].jobId).toBe("saved");
    expect(merged.jobs[0].name).toBeNull();
    expect(merged.jobs[0].layers[0]).toMatchObject({
      name: LAYER_ORDER[0],
      pmtilesUrl: "",
    });
    // The synthetic job composes into a renderable ref.
    const saved = mergeSavedOverlayJobs(null, [
      savedOverlay("saved", "vegetation"),
    ]);
    expect(
      composeTopoOverlayRefs(saved).map((r) => `${r.jobId}/${r.layer}`),
    ).toEqual(["saved/vegetation"]);
  });

  // Mutation: drop the syncRole check in shared's lidarJobSharePromise, and
  // a saved sharpened area, Shared while the list hasn't loaded, is promised
  // an older topo's download and export.
  it("synthesizes a job whose share promises only what is true of both kinds", () => {
    const merged = mergeSavedOverlayJobs(null, [
      savedOverlay("saved", LAYER_ORDER[0]),
    ]);
    expect(lidarJobSharePromise(merged.jobs[0])).toBe("lidarJob");
  });

  it("does not duplicate a key the online list already covers", () => {
    const merged = mergeSavedOverlayJobs(response(), [
      savedOverlay("old", LAYER_ORDER[0]),
    ]);
    const oldJob = merged.jobs.find((j) => j.jobId === "old")!;
    expect(oldJob.layers.filter((l) => l.name === LAYER_ORDER[0])).toHaveLength(
      1,
    );
    // The online row's presigned URL is preserved (not clobbered by the saved one).
    expect(
      oldJob.layers.find((l) => l.name === LAYER_ORDER[0])!.pmtilesUrl,
    ).toBe("https://s3/old-a");
  });

  it("appends a saved layer to an online job missing that layer", () => {
    const merged = mergeSavedOverlayJobs(response(), [
      savedOverlay("new", LAYER_ORDER[0]),
    ]);
    const newJob = merged.jobs.find((j) => j.jobId === "new")!;
    expect(newJob.layers.map((l) => l.name).sort()).toEqual(
      [LAYER_ORDER[0], LAYER_ORDER[1]].sort(),
    );
  });

  // Mutation: drop the `sourceType !== "raster"` skip in mergeSavedOverlayJobs
  // (or the `match.format` one in composeTopoOverlayRefs), and a saved vector
  // overlay mounts as a raster layer on a vector source.
  it("lists no job for a saved vector overlay, and draws none", () => {
    const merged = mergeSavedOverlayJobs(null, [
      savedOverlay("old", "contours"),
    ]);
    expect(merged.jobs).toEqual([]);
    const online = response();
    online.jobs = [
      {
        ...online.jobs[0],
        layers: [
          {
            name: "vegetation",
            format: "vector",
            pmtilesUrl: "https://s3/old-vegetation",
          },
        ],
      },
    ];
    expect(composeTopoOverlayRefs(online)).toEqual([]);
  });

  it("returns the online list unchanged when there are no saved artifacts", () => {
    expect(mergeSavedOverlayJobs(response(), [])).toEqual(response());
  });
});

describe("topoOverlayCredits", () => {
  const ref = (layer: string) =>
    ({ kind: "topo-overlay", jobId: "j", layer }) as never;

  it("credits the LiDAR source once however many LiDAR layers are on", () => {
    const lines = topoOverlayCredits([ref("hillshade"), ref("contours")]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("LiDAR");
    expect(lines[0]).toContain("CC BY 4.0");
  });

  it("says nothing with no overlay on", () => {
    expect(topoOverlayCredits([])).toEqual([]);
  });
});
