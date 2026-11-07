import { describe, expect, it } from "vitest";

import {
  groupArtifacts,
  isBundledRegionMember,
  isRegionArtifact,
  overlayJobId,
  cardDates,
  regionGroupKey,
  settleUpdate,
  supersededBy,
  unionBbox,
  type Bbox,
} from "./artifactGroups";
import type { MapArtifact } from "../map/sourceResolver";
import { regionClipKind, regionClipSpecs } from "./regionTilePlanning";

function artifact(
  overrides: Partial<MapArtifact> & { id: string },
): MapArtifact {
  return {
    kind: "basemap-region",
    logicalKey: "six-topo",
    format: "mbtiles",
    sourceType: "raster",
    path: `/tmp/${overrides.id}`,
    bbox: null,
    minzoom: null,
    maxzoom: null,
    sizeBytes: 0,
    downloadedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("group keys", () => {
  it("groups a run's rows together and leaves legacy rows standing alone", () => {
    expect(regionGroupKey(artifact({ id: "a", groupId: "run-1" }))).toBe(
      "run-1",
    );
    expect(regionGroupKey(artifact({ id: "a" }))).toBe("a");
  });

  it("takes a topo overlay's job id off its logicalKey", () => {
    expect(
      overlayJobId(artifact({ id: "a", logicalKey: "job-9/contours" })),
    ).toBe("job-9");
    // Defensive: a key with no layer suffix is its own job rather than a crash.
    expect(overlayJobId(artifact({ id: "a", logicalKey: "job-9" }))).toBe(
      "job-9",
    );
  });
});

describe("unionBbox", () => {
  it("returns null when nothing has an extent", () => {
    expect(unionBbox([null, undefined])).toBeNull();
  });

  it("covers every box given", () => {
    const a: Bbox = [150, -34, 151, -33];
    const b: Bbox = [149.5, -33.5, 150.5, -32];
    expect(unionBbox([a, null, b])).toEqual([149.5, -34, 151, -32]);
  });
});

describe("groupArtifacts", () => {
  it("sums sizes, unions extents and keeps arrival order", () => {
    const groups = groupArtifacts(
      [
        artifact({
          id: "1",
          groupId: "run-1",
          groupLabel: "Test region",
          sizeBytes: 10,
          bbox: [150, -34, 151, -33],
        }),
        artifact({ id: "2", sizeBytes: 5 }),
        artifact({
          id: "3",
          groupId: "run-1",
          groupLabel: "Test region",
          sizeBytes: 7,
          bbox: [149, -34, 150, -33],
        }),
      ],
      regionGroupKey,
    );
    expect(groups.map((g) => g.key)).toEqual(["run-1", "2"]);
    expect(groups[0].sizeBytes).toBe(17);
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].bbox).toEqual([149, -34, 151, -33]);
    expect(groups[0].label).toBe("Test region");
  });

  it("prefers the group name over a single row's rename, and falls back to it", () => {
    const [named] = groupArtifacts(
      [
        artifact({
          id: "1",
          groupId: "r",
          label: "row name",
          groupLabel: "area name",
        }),
      ],
      regionGroupKey,
    );
    expect(named.label).toBe("area name");
    const [legacy] = groupArtifacts(
      [artifact({ id: "1", label: "row name" })],
      regionGroupKey,
    );
    expect(legacy.label).toBe("row name");
    const [anonymous] = groupArtifacts([artifact({ id: "1" })], regionGroupKey);
    expect(anonymous.label).toBeNull();
  });
});

describe("a resumed download rejoins its run", () => {
  // The case this exists for: three maps for one area, one fails, the user
  // resumes it later. The map it saves must join the card its two siblings are
  // already on — a second "Region 7" card would read as a duplicate download.
  const of = (id: string, groupId: string | null): MapArtifact =>
    ({
      id,
      kind: "basemap-region",
      logicalKey: "six-topo",
      format: "mbtiles",
      sourceType: "raster",
      path: `/regions/${id}.mbtiles`,
      bbox: [150, -34, 151, -33],
      minzoom: 8,
      maxzoom: 16,
      sizeBytes: 1000,
      downloadedAt: "2026-08-16T00:00:00.000Z",
      groupId,
      groupLabel: groupId ? "Region 7" : null,
    }) as MapArtifact;

  it("merges the late arrival into the existing card", () => {
    const groups = groupArtifacts(
      [of("a", "G"), of("b", "G"), of("resumed-late", "G")],
      regionGroupKey,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].label).toBe("Region 7");
    expect(groups[0].sizeBytes).toBe(3000);
  });

  it("keeps a group-less legacy row on its own card", () => {
    const groups = groupArtifacts(
      [of("a", "G"), of("old", null)],
      regionGroupKey,
    );
    expect(groups).toHaveLength(2);
  });
});

describe("REGION_ARTIFACT_KINDS", () => {
  // Mutation: drop `slope-region` from the list, and a saved area's slope clip
  // leaves its card in Saved and the bytes sign-out warns about.
  it("holds every kind a saved area's run files", () => {
    const specs = regionClipSpecs(
      {
        bbox: { west: 150.2, south: -33.8, east: 150.4, north: -33.6 },
        groupId: "g",
        groupLabel: "Katoomba",
        allowCellular: false,
      },
      ["nsw-5m"],
      (id) => ({ id, label: id }),
    );
    const kinds = specs.map(regionClipKind);
    expect(new Set(kinds)).toEqual(
      new Set([
        "dem-region",
        "contours-region",
        "slope-region",
        "land-region",
        "fire-region",
        "basemap-region",
      ]),
    );
    for (const kind of kinds) expect(isRegionArtifact({ kind })).toBe(true);
    expect(isRegionArtifact({ kind: "topo-overlay" })).toBe(false);
  });
});

describe("isBundledRegionMember", () => {
  // Mutation: test only the kind, and the vector map (a basemap-region file
  // filed under "protomaps") gets a delete button of its own again; test only
  // the key, and the elevation and contours clips do.
  it("lets the user delete only the raster maps they picked", () => {
    const member = (kind: MapArtifact["kind"], logicalKey: string) =>
      isBundledRegionMember({ kind, logicalKey });
    expect(member("basemap-region", "six-topo")).toBe(false);
    expect(member("basemap-region", "six-imagery")).toBe(false);
    expect(member("basemap-region", "protomaps")).toBe(true);
    expect(member("dem-region", "terrarium")).toBe(true);
    expect(member("dem-region", "nsw-5m")).toBe(true);
    expect(member("contours-region", "nsw-contours")).toBe(true);
    expect(member("slope-region", "nsw-slope")).toBe(true);
    expect(member("land-region", "nsw-land")).toBe(true);
    expect(member("fire-region", "nsw-fire")).toBe(true);
    expect(member("dem-region", "lidar-abc")).toBe(true);
  });
});

describe("supersededBy", () => {
  const saved = (id: string, extra: Partial<MapArtifact> = {}) =>
    artifact({ id, groupId: "run-1", ...extra });
  // Mutation: drop the groupId test and an update of one card deletes the
  // same map from every other saved area; drop the logicalKey test and it
  // deletes the card's other maps.
  it("names only the same map in the same card", () => {
    const fresh = saved("new");
    const all = [
      fresh,
      saved("old"),
      saved("other-map", { logicalKey: "six-imagery" }),
      saved("other-card", { groupId: "run-2" }),
      saved("clip", { kind: "dem-region" }),
    ];
    expect(supersededBy(fresh, all).map((a) => a.id)).toEqual(["old"]);
  });

  it("finds a legacy row, which stands alone under its own id", () => {
    const legacy = artifact({ id: "legacy" });
    const fresh = artifact({ id: "new", groupId: "legacy" });
    expect(supersededBy(fresh, [legacy, fresh]).map((a) => a.id)).toEqual([
      "legacy",
    ]);
  });
});

describe("settleUpdate", () => {
  const saved = (id: string, extra: Partial<MapArtifact> = {}) =>
    artifact({ id, groupId: "run-1", ...extra });
  const old = saved("old", { downloadedAt: "2026-10-03T00:00:00.000Z" });
  const fresh = saved("new", { downloadedAt: "2026-11-06T00:00:00.000Z" });

  // Mutation: ignore the failed-tile count and an update trades a whole copy
  // for one with holes.
  it("keeps the older copy when the new one has dead tiles", () => {
    expect(settleUpdate(fresh, 3, [fresh, old])).toEqual({
      accepted: false,
      drop: [fresh],
      firstSavedAt: null,
    });
  });

  it("accepts dead tiles on a first save, which has nothing to keep", () => {
    expect(settleUpdate(fresh, 3, [fresh]).accepted).toBe(true);
  });

  // Mutation: carry the newer time and the card moves to the top of Saved.
  it("passes the older copy's first-saved time to the new one", () => {
    const earlier = saved("older", {
      firstSavedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(settleUpdate(fresh, 0, [fresh, old, earlier])).toEqual({
      accepted: true,
      drop: [old, earlier],
      firstSavedAt: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe("cardDates", () => {
  // Mutation: take the newest file's time as the saved time, and an updated
  // card claims to be saved the day it was updated.
  it("says when it was first saved, and updated only once a file was replaced", () => {
    const first = artifact({
      id: "a",
      downloadedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(cardDates([first])).toEqual({
      savedAt: "2026-10-03T00:00:00.000Z",
      updatedAt: null,
    });
    const replaced = artifact({
      id: "b",
      downloadedAt: "2026-11-06T00:00:00.000Z",
      firstSavedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(cardDates([replaced, first])).toEqual({
      savedAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-11-06T00:00:00.000Z",
    });
  });
});
