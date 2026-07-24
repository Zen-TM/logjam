import { describe, it, expect } from "vitest";
import { TOPO_LAYERS } from "@logjam/shared";
import {
  composeTopoOverlayRefs,
  mergeSavedOverlayJobs,
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
  const layerByName = Object.fromEntries(TOPO_LAYERS.map((l) => [l.name, l]));
  return {
    expiresAt: "2026-07-24T00:00:00Z",
    jobs: [
      {
        jobId: "old",
        name: "Old job",
        createdAt: "2026-07-01T00:00:00Z",
        layers: [
          { name: LAYER_ORDER[0], format: layerByName[LAYER_ORDER[0]].format, pmtilesUrl: "https://s3/old-a" },
          { name: LAYER_ORDER[1], format: layerByName[LAYER_ORDER[1]].format, pmtilesUrl: "https://s3/old-b" },
        ],
      },
      {
        jobId: "new",
        name: "New job",
        createdAt: "2026-07-20T00:00:00Z",
        layers: [
          { name: LAYER_ORDER[0], format: layerByName[LAYER_ORDER[0]].format, pmtilesUrl: "https://s3/new-a" },
        ],
      },
    ],
  };
}

describe("composeTopoOverlayRefs", () => {
  it("renders nothing when no layers are enabled", () => {
    expect(composeTopoOverlayRefs(response(), new Set())).toEqual([]);
  });

  it("orders layer-band outer, newest-job-first inner (web parity)", () => {
    const enabled = new Set([
      `old/${LAYER_ORDER[0]}`,
      `new/${LAYER_ORDER[0]}`,
      `old/${LAYER_ORDER[1]}`,
    ]);
    const refs = composeTopoOverlayRefs(response(), enabled);
    expect(refs.map((r) => `${r.jobId}/${r.layer}`)).toEqual([
      `new/${LAYER_ORDER[0]}`,
      `old/${LAYER_ORDER[0]}`,
      `old/${LAYER_ORDER[1]}`,
    ]);
  });

  it("filters to enabled keys only and carries the presigned URL", () => {
    const refs = composeTopoOverlayRefs(response(), new Set([`new/${LAYER_ORDER[0]}`]));
    expect(refs).toHaveLength(1);
    expect(refs[0].remoteUrl).toBe("https://s3/new-a");
    expect(refs[0].attribution).toBeTruthy();
  });
});

describe("mergeSavedOverlayJobs", () => {
  it("synthesizes a job from a saved artifact when the online list is empty", () => {
    const merged = mergeSavedOverlayJobs(null, [savedOverlay("saved", LAYER_ORDER[0])]);
    expect(merged.jobs).toHaveLength(1);
    expect(merged.jobs[0].jobId).toBe("saved");
    expect(merged.jobs[0].name).toBeNull();
    expect(merged.jobs[0].layers[0]).toMatchObject({
      name: LAYER_ORDER[0],
      pmtilesUrl: "",
    });
    // The synthetic job composes into a renderable ref when enabled.
    const refs = composeTopoOverlayRefs(merged, new Set([`saved/${LAYER_ORDER[0]}`]));
    expect(refs.map((r) => `${r.jobId}/${r.layer}`)).toEqual([`saved/${LAYER_ORDER[0]}`]);
  });

  it("does not duplicate a key the online list already covers", () => {
    const merged = mergeSavedOverlayJobs(response(), [savedOverlay("old", LAYER_ORDER[0])]);
    const oldJob = merged.jobs.find((j) => j.jobId === "old")!;
    expect(oldJob.layers.filter((l) => l.name === LAYER_ORDER[0])).toHaveLength(1);
    // The online row's presigned URL is preserved (not clobbered by the saved one).
    expect(oldJob.layers.find((l) => l.name === LAYER_ORDER[0])!.pmtilesUrl).toBe(
      "https://s3/old-a",
    );
  });

  it("appends a saved layer to an online job missing that layer", () => {
    const merged = mergeSavedOverlayJobs(response(), [savedOverlay("new", LAYER_ORDER[1])]);
    const newJob = merged.jobs.find((j) => j.jobId === "new")!;
    expect(newJob.layers.map((l) => l.name).sort()).toEqual(
      [LAYER_ORDER[0], LAYER_ORDER[1]].sort(),
    );
  });

  it("returns the online list unchanged when there are no saved artifacts", () => {
    expect(mergeSavedOverlayJobs(response(), [])).toEqual(response());
  });
});
