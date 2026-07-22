import { describe, it, expect } from "vitest";
import { TOPO_LAYERS } from "@logjam/shared";
import { composeTopoOverlayRefs, type CompletedOverlaysResponse } from "./topoOverlays";

const LAYER_ORDER = TOPO_LAYERS.map((l) => l.name);

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
