import { describe, it, expect } from "vitest";
import {
  basemapsCoveringViewport,
  resolveMapSource,
  hashKey,
  type BasemapId,
  type MapArtifact,
  type ResolveContext,
  type Viewport,
} from "./sourceResolver";

const CDN = "https://logjamnsw.com";

function ctx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    connectivity: "online",
    artifacts: [],
    cdnBaseUrl: CDN,
    ...overrides,
  };
}

function artifact(overrides: Partial<MapArtifact>): MapArtifact {
  return {
    id: "a1",
    kind: "topo-overlay",
    logicalKey: "job1/hillshade",
    format: "pmtiles",
    sourceType: "raster",
    path: "/data/user/0/app/files/maps/a1.pmtiles",
    bbox: null,
    minzoom: null,
    maxzoom: null,
    sizeBytes: 1,
    downloadedAt: "2026-07-23T00:00:00Z",
    ...overrides,
  };
}

describe("basemap resolution", () => {
  it("online: catalog raster resolves to remote XYZ tiles with display cap", () => {
    const [r] = resolveMapSource(
      { kind: "basemap", basemapId: "six-topo" },
      ctx(),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.sourceType).toBe("raster");
    expect(r.tiles![0]).toContain("maps.six.nsw.gov.au");
    expect(r.maxZoom).toBe(16);
    expect(r.origin).toBe("remote");
  });

  it("offline: OSM-family is online-only by policy", () => {
    const [r] = resolveMapSource(
      { kind: "basemap", basemapId: "osm-topo" },
      ctx({ connectivity: "offline" }),
    );
    expect(r).toMatchObject({
      status: "unavailable",
      reason: "online-only-source",
    });
  });

  it("offline: offline-capable basemap without downloads is unavailable (no silent remote fallback)", () => {
    const [r] = resolveMapSource(
      { kind: "basemap", basemapId: "six-topo" },
      ctx({ connectivity: "offline" }),
    );
    expect(r).toMatchObject({
      status: "unavailable",
      reason: "offline-not-downloaded",
    });
  });

  it("offline: resolves to ALL downloaded regions with bounds and zoom clamps", () => {
    const regions = [
      artifact({
        id: "r1",
        kind: "basemap-region",
        logicalKey: "six-topo",
        bbox: [150.1, -33.9, 150.5, -33.5],
        minzoom: 10,
        maxzoom: 16,
        path: "/files/maps/r1.pmtiles",
      }),
      artifact({
        id: "r2",
        kind: "basemap-region",
        logicalKey: "six-topo",
        bbox: [150.6, -33.9, 151.0, -33.5],
        minzoom: 10,
        maxzoom: 16,
        path: "/files/maps/r2.pmtiles",
      }),
    ];
    const resolved = resolveMapSource(
      { kind: "basemap", basemapId: "six-topo" },
      ctx({ connectivity: "offline", artifacts: regions }),
    );
    expect(resolved).toHaveLength(2);
    for (const r of resolved) {
      expect(r.status).toBe("ok");
      if (r.status !== "ok") continue;
      expect(r.origin).toBe("local");
      expect(r.bounds).toBeDefined();
      expect(r.minZoom).toBe(10);
      expect(r.maxZoom).toBe(16);
      expect(r.url).toMatch(/^pmtiles:\/\/file:\/\//);
    }
  });

  it("forced-offline behaves like offline (user override)", () => {
    const [r] = resolveMapSource(
      { kind: "basemap", basemapId: "osm-topo" },
      ctx({ connectivity: "forced-offline" }),
    );
    expect(r.status).toBe("unavailable");
  });

  it("online: subset-coverage basemaps prefer remote even when a region is downloaded", () => {
    const [r] = resolveMapSource(
      { kind: "basemap", basemapId: "six-topo" },
      ctx({
        artifacts: [
          artifact({
            kind: "basemap-region",
            logicalKey: "six-topo",
            bbox: [1, 2, 3, 4],
          }),
        ],
      }),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.origin).toBe("remote");
  });

  it("throws loudly on an unknown basemap id", () => {
    expect(() =>
      resolveMapSource({ kind: "basemap", basemapId: "bogus" as never }, ctx()),
    ).toThrow(/Unknown basemap id/);
  });
});

describe("topo-overlay resolution (full coverage → local-first always)", () => {
  const ref = {
    kind: "topo-overlay" as const,
    jobId: "job1",
    layer: "hillshade" as never,
    format: "raster" as const,
    remoteUrl: "https://s3.example.com/job1/hillshade.pmtiles?sig=abc",
  };

  it("online without a download: remote presigned pmtiles URL", () => {
    const [r] = resolveMapSource(ref, ctx());
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.url).toBe(`pmtiles://${ref.remoteUrl}`);
    expect(r.origin).toBe("remote");
    expect(r.tileSize).toBe(256);
  });

  it("downloaded: local wins even while ONLINE (no connectivity-flap remounts)", () => {
    const [r] = resolveMapSource(
      ref,
      ctx({ artifacts: [artifact({ logicalKey: "job1/hillshade" })] }),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.origin).toBe("local");
    expect(r.url).toMatch(/^pmtiles:\/\/file:\/\//);
  });

  it("a rotated presigned URL produces a different key (remount)", () => {
    const [a] = resolveMapSource(ref, ctx());
    const [b] = resolveMapSource(
      { ...ref, remoteUrl: `${ref.remoteUrl}2` },
      ctx(),
    );
    expect(a.key).not.toBe(b.key);
  });

  it("online with an expired/absent remote URL: unavailable no-remote-url", () => {
    const [r] = resolveMapSource({ ...ref, remoteUrl: null }, ctx());
    expect(r).toMatchObject({ status: "unavailable", reason: "no-remote-url" });
  });

  it("offline without a download: unavailable", () => {
    const [r] = resolveMapSource(ref, ctx({ connectivity: "offline" }));
    expect(r).toMatchObject({
      status: "unavailable",
      reason: "offline-not-downloaded",
    });
  });

  it("mbtiles artifacts ride `tiles`, pmtiles ride `url`", () => {
    const [r] = resolveMapSource(
      ref,
      ctx({
        artifacts: [
          artifact({
            logicalKey: "job1/hillshade",
            format: "mbtiles",
            path: "/files/x.mbtiles",
          }),
        ],
      }),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.url).toBeUndefined();
    expect(r.tiles).toEqual(["mbtiles:///files/x.mbtiles"]);
  });
});

describe("imports (always local)", () => {
  it("resolves a geopdf import from the registry regardless of connectivity", () => {
    const [r] = resolveMapSource(
      { kind: "geopdf-import", importId: "imp1" },
      ctx({
        connectivity: "offline",
        artifacts: [
          artifact({
            kind: "geopdf-import",
            logicalKey: "imp1",
            format: "mbtiles",
            bbox: [150, -34, 151, -33],
          }),
        ],
      }),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.origin).toBe("local");
    expect(r.bounds).toEqual([150, -34, 151, -33]);
  });

  it("missing import registry row: unavailable", () => {
    const [r] = resolveMapSource(
      { kind: "vector-import", importId: "nope" },
      ctx(),
    );
    expect(r.status).toBe("unavailable");
  });
});

describe("hashKey", () => {
  it("is deterministic and distinguishes different URLs", () => {
    expect(hashKey("abc")).toBe(hashKey("abc"));
    expect(hashKey("abc")).not.toBe(hashKey("abd"));
  });
});

describe("basemapsCoveringViewport", () => {
  const CANDIDATES: BasemapId[] = [
    "protomaps",
    "six-topo",
    "six-base",
    "six-imagery",
  ];
  // Two saved regions over roughly the same ground, one basemap each: a big
  // six-topo area with a smaller protomaps clip inside it.
  const saved = [
    artifact({
      id: "r1",
      kind: "basemap-region",
      logicalKey: "six-topo",
      bbox: [150, -34, 151, -33],
    }),
    artifact({
      id: "r2",
      kind: "basemap-region",
      logicalKey: "protomaps",
      bbox: [150.4, -33.6, 150.6, -33.4],
    }),
  ];
  const view = (west: number, south: number, east: number, north: number) => ({
    west,
    south,
    east,
    north,
  });

  it("names every basemap with saved tiles on screen", () => {
    expect(
      basemapsCoveringViewport(
        saved,
        view(150.45, -33.55, 150.55, -33.45),
        CANDIDATES,
      ),
    ).toEqual(["protomaps", "six-topo"]);
  });

  it("drops a basemap whose region is off screen", () => {
    // Inside the six-topo region, well clear of the protomaps clip: an
    // unconstrained region check would wrongly report the vector basemap as
    // available over ground it has nothing for.
    expect(
      basemapsCoveringViewport(
        saved,
        view(150.05, -33.95, 150.15, -33.85),
        CANDIDATES,
      ),
    ).toEqual(["six-topo"]);
  });

  it("is empty when the viewport is nowhere near anything saved", () => {
    expect(
      basemapsCoveringViewport(saved, view(145, -31, 146, -30), CANDIDATES),
    ).toEqual([]);
  });

  it("counts a viewport that only clips a region's corner", () => {
    // Overlap, not containment: there IS saved map on screen, and telling the
    // user to switch away from it would be wrong.
    expect(
      basemapsCoveringViewport(
        saved,
        view(150.9, -33.1, 151.5, -32.5),
        CANDIDATES,
      ),
    ).toEqual(["six-topo"]);
  });

  it("ignores artifacts that are not basemap regions", () => {
    const overlay = [
      artifact({
        kind: "topo-overlay",
        logicalKey: "six-topo",
        bbox: [150, -34, 151, -33],
      }),
    ];
    expect(
      basemapsCoveringViewport(
        overlay,
        view(150.4, -33.6, 150.6, -33.4),
        CANDIDATES,
      ),
    ).toEqual([]);
  });
});

describe("statewide contours", () => {
  it("online: the CDN's archive", () => {
    const [r] = resolveMapSource({ kind: "nsw-contours" }, ctx());
    expect(r).toMatchObject({
      status: "ok",
      sourceType: "vector",
      url: `pmtiles://${CDN}/master/contours/nsw-10m.pmtiles`,
    });
  });

  // Mutation: match saved clips by `basemap-region` and the vector basemap's
  // own clip is drawn as contours (and the reverse in snapRegion.ts).
  it("offline: only the contour clips saved, never a basemap's", () => {
    const saved = [
      artifact({ id: "c", kind: "contours-region", sourceType: "vector" }),
      artifact({ id: "b", kind: "basemap-region", logicalKey: "protomaps" }),
    ];
    const resolved = resolveMapSource(
      { kind: "nsw-contours" },
      ctx({ connectivity: "offline", artifacts: saved }),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ status: "ok", origin: "local" });
    expect(
      resolveMapSource(
        { kind: "nsw-contours" },
        ctx({ connectivity: "offline" }),
      ),
    ).toMatchObject([{ status: "unavailable" }]);
  });
});

describe("statewide slope and hillshade", () => {
  // Mutation: resolve either as `raster`, and MapLibre draws the terrarium
  // PNGs as coloured noise instead of a slope or a shade.
  it("online: the CDN's DEM archives, as DEMs", () => {
    const [slope] = resolveMapSource({ kind: "nsw-slope" }, ctx());
    expect(slope).toMatchObject({
      status: "ok",
      sourceType: "raster-dem",
      url: `pmtiles://${CDN}/master/dem/nsw-5m-slope.pmtiles`,
      attribution: expect.stringMatching(/^Slope: derived from the NSW 5 m/),
    });
    const [shade] = resolveMapSource({ kind: "nsw-hillshade" }, ctx());
    expect(shade).toMatchObject({
      status: "ok",
      sourceType: "raster-dem",
      url: `pmtiles://${CDN}/master/dem/nsw-5m.pmtiles`,
      attribution: expect.stringMatching(/^Hillshade: derived/),
    });
  });

  // Mutation: match the slope by `dem-region`, and offline the saved
  // heights are coloured as if they were degrees.
  it("offline: the slope from its own clips, the shade from none", () => {
    const saved = [
      artifact({ id: "c", kind: "contours-region", sourceType: "vector" }),
      artifact({ id: "d", kind: "dem-region", logicalKey: "nsw-5m" }),
      artifact({ id: "s", kind: "slope-region", sourceType: "raster-dem" }),
    ];
    const offline = ctx({ connectivity: "offline", artifacts: saved });
    const slope = resolveMapSource({ kind: "nsw-slope" }, offline);
    expect(slope).toHaveLength(1);
    expect(slope[0]).toMatchObject({
      status: "ok",
      origin: "local",
      sourceType: "raster-dem",
    });
    expect(resolveMapSource({ kind: "nsw-hillshade" }, offline)).toMatchObject([
      { status: "unavailable" },
    ]);
  });
  // Mutation: draw every slope clip, as the contours do, and where two saved
  // areas share a tile its bands are painted twice, darker.
  it("draws one slope clip offline, the area nearest the middle of the screen", () => {
    const at = (id: string, west: number): MapArtifact =>
      artifact({
        id,
        kind: "slope-region",
        sourceType: "raster-dem",
        path: `/maps/${id}.pmtiles`,
        bbox: [west, -33.8, west + 0.1, -33.7],
      });
    const offline = ctx({
      connectivity: "offline",
      artifacts: [at("katoomba", 150.3), at("blackheath", 150.25)],
    });
    const drawn = (viewport: Viewport | null) =>
      resolveMapSource({ kind: "nsw-slope", viewport }, offline).map(
        (r) => r.status === "ok" && r.url,
      );
    const screen = (lng: number): Viewport => ({
      west: lng - 0.02,
      south: -33.77,
      east: lng + 0.02,
      north: -33.73,
    });
    expect(drawn(screen(150.36))).toEqual([
      "pmtiles://file:///maps/katoomba.pmtiles",
    ]);
    expect(drawn(screen(150.1))).toEqual([
      "pmtiles://file:///maps/blackheath.pmtiles",
    ]);
    expect(drawn(null)).toEqual(["pmtiles://file:///maps/katoomba.pmtiles"]);
  });
});
