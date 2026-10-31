import { describe, it, expect } from "vitest";
import type { SharpenedOverlay } from "@logjam/shared";
import { tileRectBounds, tileRectCovering } from "./terrainRoutes";
import {
  basemapsCoveringViewport,
  resolveMapSource,
  hashKey,
  holdsContours,
  holdsHillshade,
  holdsSlope,
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

  // Mutation: drop the `.reverse()`, and where two saves overlap the older one
  // draws on top. The registry lists the newest first.
  it("offline: lists saved regions oldest first, so the newest mounts on top", () => {
    const save = (id: string, path: string) =>
      artifact({ id, kind: "basemap-region", logicalKey: "protomaps", path });
    const newest = save("new", "/files/maps/new.pmtiles");
    const oldest = save("old", "/files/maps/old.pmtiles");
    const resolved = resolveMapSource(
      { kind: "basemap", basemapId: "protomaps" },
      ctx({ connectivity: "offline", artifacts: [newest, oldest] }),
    );
    expect(resolved.map((r) => (r.status === "ok" ? r.url : null))).toEqual([
      "pmtiles://file:///files/maps/old.pmtiles",
      "pmtiles://file:///files/maps/new.pmtiles",
    ]);
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
      artifact({
        id: "c",
        kind: "contours-region",
        logicalKey: "nsw-contours",
        sourceType: "vector",
      }),
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
  it("offline: the slope from its own clips, the shade from the saved heights", () => {
    const saved = [
      artifact({
        id: "c",
        kind: "contours-region",
        logicalKey: "nsw-contours",
        sourceType: "vector",
      }),
      artifact({ id: "w", kind: "dem-region", logicalKey: "terrarium" }),
      artifact({
        id: "d",
        kind: "dem-region",
        logicalKey: "nsw-5m",
        sourceType: "raster",
        minzoom: 8,
        maxzoom: 15,
      }),
      artifact({
        id: "s",
        kind: "slope-region",
        logicalKey: "nsw-5m-slope",
        sourceType: "raster-dem",
      }),
    ];
    const offline = ctx({ connectivity: "offline", artifacts: saved });
    const slope = resolveMapSource({ kind: "nsw-slope" }, offline);
    expect(slope).toHaveLength(1);
    expect(slope[0]).toMatchObject({
      status: "ok",
      origin: "local",
      sourceType: "raster-dem",
    });
    // Mutation: drop the logicalKey and the worldwide tiles (an MBTiles) are
    // drawn too; keep the registered `raster` and MapLibre draws noise.
    const shade = resolveMapSource({ kind: "nsw-hillshade" }, offline);
    expect(shade).toHaveLength(1);
    expect(shade[0]).toMatchObject({
      status: "ok",
      origin: "local",
      sourceType: "raster-dem",
      minZoom: 8,
      maxZoom: 15,
    });
  });
  // Mutation: let a clip saved at z15 alone count (drop the `minzoom` test in
  // `holdsHillshade`), and the sheet enables a switch that draws nothing below
  // z15, and an old clip with a bigger bbox beats the new one.
  it("holdsHillshade: only the nsw-5m clip that reaches z8", () => {
    const clip = {
      kind: "dem-region",
      logicalKey: "nsw-5m",
      minzoom: 8,
    } as const;
    expect(holdsHillshade(clip)).toBe(true);
    expect(holdsHillshade({ ...clip, minzoom: 15 })).toBe(false);
    expect(holdsHillshade({ ...clip, minzoom: null })).toBe(false);
    expect(holdsHillshade({ ...clip, logicalKey: "terrarium" })).toBe(false);
    expect(holdsHillshade({ ...clip, kind: "slope-region" })).toBe(false);
  });
  // Mutation: drop the `logicalKey` test, and a sharpened area's contour or
  // slope clip (filed as the same kind) enables the statewide switch.
  // Mutation: resolve Land with no `nearestRegion`, and two saved areas that
  // share a low-zoom tile paint its translucent tint twice, with a seam.
  it("draws one land clip offline, and the archive online", () => {
    const at = (id: string, west: number): MapArtifact =>
      artifact({
        id,
        kind: "land-region",
        logicalKey: "nsw-land",
        sourceType: "vector",
        path: `/maps/${id}.pmtiles`,
        bbox: [west, -33.8, west + 0.1, -33.7],
      });
    const offline = ctx({
      connectivity: "offline",
      artifacts: [at("katoomba", 150.3), at("blackheath", 150.25)],
    });
    expect(resolveMapSource({ kind: "nsw-land" }, offline)).toHaveLength(1);
    const [online] = resolveMapSource({ kind: "nsw-land" }, ctx({}));
    expect(online).toMatchObject({ status: "ok", sourceType: "vector" });
    expect(online!.status === "ok" && online!.url).toContain(
      "master/land/nsw-tenure.pmtiles",
    );
  });

  it("holdsContours and holdsSlope: the statewide clip, not an area's", () => {
    expect(
      holdsContours({ kind: "contours-region", logicalKey: "nsw-contours" }),
    ).toBe(true);
    expect(
      holdsContours({ kind: "contours-region", logicalKey: "area-1" }),
    ).toBe(false);
    expect(
      holdsContours({ kind: "slope-region", logicalKey: "nsw-contours" }),
    ).toBe(false);
    expect(
      holdsSlope({ kind: "slope-region", logicalKey: "nsw-5m-slope" }),
    ).toBe(true);
    expect(holdsSlope({ kind: "slope-region", logicalKey: "area-1" })).toBe(
      false,
    );
  });
  it("offline: a clip saved at z15 alone gives no shade, and never beats a z8-15 one", () => {
    const old = artifact({
      id: "old",
      kind: "dem-region",
      logicalKey: "nsw-5m",
      bbox: [150, -34, 151, -33],
      minzoom: 15,
      maxzoom: 15,
    });
    expect(
      resolveMapSource(
        { kind: "nsw-hillshade" },
        ctx({ connectivity: "offline", artifacts: [old] }),
      ),
    ).toMatchObject([{ status: "unavailable" }]);
    const fresh = artifact({
      id: "fresh",
      kind: "dem-region",
      logicalKey: "nsw-5m",
      bbox: [150.2, -33.8, 150.3, -33.7],
      minzoom: 8,
      maxzoom: 15,
    });
    const shade = resolveMapSource(
      { kind: "nsw-hillshade" },
      ctx({ connectivity: "offline", artifacts: [old, fresh] }),
    );
    expect(shade).toHaveLength(1);
    expect(shade[0]).toMatchObject({ status: "ok", minZoom: 8 });
  });
  it("offline: no saved heights, no shade", () => {
    const only = artifact({ kind: "dem-region", logicalKey: "terrarium" });
    expect(
      resolveMapSource(
        { kind: "nsw-hillshade" },
        ctx({ connectivity: "offline", artifacts: [only] }),
      ),
    ).toMatchObject([{ status: "unavailable" }]);
  });
  // Mutation: draw every slope clip, as the contours do, and where two saved
  // areas share a tile its bands are painted twice, darker.
  it("draws one slope clip offline, of those on screen the one covering most", () => {
    const at = (id: string, west: number): MapArtifact =>
      artifact({
        id,
        kind: "slope-region",
        logicalKey: "nsw-5m-slope",
        sourceType: "raster-dem",
        path: `/maps/${id}.pmtiles`,
        bbox: [west, -33.8, west + 0.1, -33.7],
      });
    const offline = ctx({
      connectivity: "offline",
      artifacts: [at("katoomba", 150.3), at("blackheath", 150.25)],
    });
    const drawn = (viewport: Viewport | null) =>
      resolveMapSource({ kind: "nsw-slope", viewport }, offline).flatMap((r) =>
        r.status === "ok" && r.url ? [r.url] : [],
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
  // Mutation: drop the size tie-break, and the newest area (the registry's
  // first) wins every tie: the canyon's clip, whose bounds crop the slope.
  it("draws the wider clip where a saved area sits inside another", () => {
    const clip = (id: string, bbox: MapArtifact["bbox"]): MapArtifact =>
      artifact({
        id,
        kind: "slope-region",
        logicalKey: "nsw-5m-slope",
        sourceType: "raster-dem",
        path: `/maps/${id}.pmtiles`,
        bbox,
      });
    const offline = ctx({
      connectivity: "offline",
      artifacts: [
        clip("canyon", [150.3, -33.75, 150.32, -33.73]),
        clip("valley", [150.2, -33.9, 150.5, -33.6]),
      ],
    });
    const screen: Viewport = {
      west: 150.3,
      south: -33.75,
      east: 150.32,
      north: -33.73,
    };
    for (const viewport of [screen, null])
      expect(
        resolveMapSource({ kind: "nsw-slope", viewport }, offline).flatMap(
          (r) => (r.status === "ok" && r.url ? [r.url] : []),
        ),
      ).toEqual(["pmtiles://file:///maps/valley.pmtiles"]);
  });
  // Mutation: drop `onScreen` from the sort, and the small clip nearer the
  // middle wins, cutting the shading off across most of the screen.
  it("draws the clip covering most of the screen", () => {
    const clip = (id: string, west: number, east: number): MapArtifact =>
      artifact({
        id,
        kind: "slope-region",
        logicalKey: "nsw-5m-slope",
        sourceType: "raster-dem",
        path: `/maps/${id}.pmtiles`,
        bbox: [west, -33.8, east, -33.7],
      });
    const viewport: Viewport = {
      west: 150.28,
      south: -33.76,
      east: 150.34,
      north: -33.74,
    };
    expect(
      resolveMapSource(
        { kind: "nsw-slope", viewport },
        ctx({
          connectivity: "offline",
          artifacts: [
            clip("small", 150.305, 150.315),
            clip("wide", 150.2, 150.3),
          ],
        }),
      ).flatMap((r) => (r.status === "ok" && r.url ? [r.url] : [])),
    ).toEqual(["pmtiles://file:///maps/wide.pmtiles"]);
  });
});

describe("routes the Terrain group", () => {
  // A made-up area, and the same one after the list signed new URLs.
  const area = (signature: string, contours = true): SharpenedOverlay => ({
    id: "area-1",
    zmax: 17,
    tiles15: [100, 200, 103, 203],
    coverage: [0, 0, 0, 0],
    contours,
    credit: "Made-up area credit",
    createdAt: "2026-10-01T00:00:00Z",
    heightsUrl: `https://bucket.example/h.pmtiles?X-Amz-Signature=${signature}`,
    slopeUrl: `https://bucket.example/s.pmtiles?X-Amz-Signature=${signature}`,
    contoursUrl: contours
      ? `https://bucket.example/c.pmtiles?X-Amz-Signature=${signature}`
      : null,
  });
  const ok = (sources: ReturnType<typeof resolveMapSource>) =>
    sources.flatMap((s) => (s.status === "ok" ? [s] : []));

  // Red if statewide isn't stopped at z15, or a DEM TileJSON loses its
  // terrarium encoding.
  it("stops statewide slope at z15 and reads each rectangle from one archive", () => {
    const sources = ok(
      resolveMapSource(
        { kind: "nsw-slope" },
        ctx({ sharpenedAreas: [area("a")] }),
      ),
    );
    const [statewide, ...routed] = sources;
    expect(statewide.url).toBe(
      `pmtiles://${CDN}/master/dem/nsw-5m-slope.pmtiles`,
    );
    expect(statewide.layerMaxZoom).toBe(15);
    const own = routed.filter((r) => r.attribution === "Made-up area credit");
    expect(own).toHaveLength(1);
    expect(own[0].tileJson).toMatchObject({
      tiles: ["pmtiles://https://sharpened-area.invalid/area-1/slope.pmtiles"],
      minzoom: 15,
      maxzoom: 17,
      encoding: "terrarium",
    });
    for (const r of routed) {
      expect(r.layerMinZoom).toBe(15);
      if (r !== own[0])
        expect(r.tileJson).toMatchObject({
          tiles: [statewide.url],
          maxzoom: 15,
        });
    }
  });

  // Red if the hillshade reads the slope archive.
  it("shades the hillshade from the area's heights", () => {
    const routed = ok(
      resolveMapSource(
        { kind: "nsw-hillshade" },
        ctx({ sharpenedAreas: [area("a")] }),
      ),
    );
    expect(JSON.stringify(routed)).toContain("area-1/heights.pmtiles");
  });

  // Red if an area's contours are read past z14.
  it("routes contours from z14, to the area's z14 archive", () => {
    const [statewide, ...routed] = ok(
      resolveMapSource(
        { kind: "nsw-contours" },
        ctx({ sharpenedAreas: [area("a")] }),
      ),
    );
    expect(statewide.layerMaxZoom).toBe(14);
    const own = routed.find((r) => r.attribution === "Made-up area credit");
    expect(own?.tileJson).toMatchObject({ minzoom: 14, maxzoom: 14 });
    expect(own?.tileJson?.encoding).toBeUndefined();
  });

  // Red if an area without contours takes a contour rectangle.
  it("leaves the statewide contours where an area has none", () => {
    const routed = ok(
      resolveMapSource(
        { kind: "nsw-contours" },
        ctx({ sharpenedAreas: [area("a", false)] }),
      ),
    );
    expect(routed.some((r) => r.attribution === "Made-up area credit")).toBe(
      false,
    );
  });

  // Red if a source reads the presigned URL instead of the fixed address.
  it("puts no presigned URL in a source, so new URLs remount nothing", () => {
    const before = resolveMapSource(
      { kind: "nsw-slope" },
      ctx({ sharpenedAreas: [area("a")] }),
    );
    const after = resolveMapSource(
      { kind: "nsw-slope" },
      ctx({ sharpenedAreas: [area("b")] }),
    );
    expect(JSON.stringify(before)).not.toContain("X-Amz");
    expect(after.map((s) => s.key)).toEqual(before.map((s) => s.key));
  });

  // Red if saved clips are routed offline.
  it("draws statewide alone with no area, and offline", () => {
    expect(resolveMapSource({ kind: "nsw-slope" }, ctx())).toEqual(
      resolveMapSource({ kind: "nsw-slope" }, ctx({ sharpenedAreas: [] })),
    );
    const [only] = ok(resolveMapSource({ kind: "nsw-slope" }, ctx()));
    expect(only.layerMaxZoom).toBeUndefined();
    // Offline, a saved clip: the area's archive can't be reached.
    const saved = {
      connectivity: "offline" as const,
      artifacts: [
        artifact({
          kind: "slope-region",
          logicalKey: "nsw-5m-slope",
          sourceType: "raster-dem",
          bbox: [150, -34, 151, -33],
        }),
      ],
    };
    const offline = ok(
      resolveMapSource(
        { kind: "nsw-slope" },
        ctx({ ...saved, sharpenedAreas: [area("a")] }),
      ),
    );
    expect(offline).toHaveLength(1);
    expect(offline).toEqual(
      ok(resolveMapSource({ kind: "nsw-slope" }, ctx(saved))),
    );
  });
});

describe("routes saved areas offline", () => {
  // A made-up kept area, and the clips a saved area took of it and of the
  // statewide archives. An area clip's bounds are its z15 tiles.
  const kept = {
    id: "area-1",
    zmax: 17 as const,
    tiles15: [100, 200, 103, 203] as const,
    coverage: [0, 0, 0, 0] as const,
    contours: true,
    credit: "Made-up area credit",
    createdAt: "2026-10-01T00:00:00Z",
  };
  const areaBounds: MapArtifact["bbox"] = tileRectBounds(15, kept.tiles15);
  const clip = (
    id: string,
    kind: MapArtifact["kind"],
    logicalKey: string,
    bbox: MapArtifact["bbox"] = [-179, 84.8, -178.8, 84.9],
  ) =>
    artifact({
      id,
      kind,
      logicalKey,
      sourceType: kind === "contours-region" ? "vector" : "raster-dem",
      path: `/maps/${id}.pmtiles`,
      bbox,
      minzoom: 8,
      maxzoom: 15,
    });
  const offline = (artifacts: MapArtifact[], keptAreas = [kept]) =>
    ctx({
      connectivity: "offline",
      artifacts,
      keptSharpenedAreas: keptAreas,
    });
  const ok = (sources: ReturnType<typeof resolveMapSource>) =>
    sources.flatMap((s) => (s.status === "ok" ? [s] : []));

  // Red if offline routing reads the list's fixed addresses, or the
  // statewide clip still draws past z15 under the area.
  it("reads the area's saved clip inside it and the statewide clip around it", () => {
    const [statewide, ...routed] = ok(
      resolveMapSource(
        { kind: "nsw-slope" },
        offline([
          clip("s", "slope-region", "nsw-5m-slope"),
          clip("a", "slope-region", "lidar-area-1", areaBounds),
        ]),
      ),
    );
    expect(statewide.url).toBe("pmtiles://file:///maps/s.pmtiles");
    expect(statewide.layerMaxZoom).toBe(15);
    const own = routed.filter((r) => r.attribution === "Made-up area credit");
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      origin: "local",
      layerMinZoom: 15,
      tileJson: {
        tiles: ["pmtiles://file:///maps/a.pmtiles"],
        maxzoom: 17,
        encoding: "terrarium",
      },
    });
    for (const r of routed)
      if (r !== own[0])
        expect(r.tileJson?.tiles).toEqual(["pmtiles://file:///maps/s.pmtiles"]);
  });

  // Mutation: leave `savedStatewideClips` out of the areas, and past z14 the
  // shading stops at the edge of the one clip drawn; route them without bounds,
  // and shared tiles paint twice.
  it("routes two saved clips offline, each z15 tile from one of them", () => {
    const west = clip(
      "west",
      "dem-region",
      "nsw-5m",
      [-179, 84.8, -178.8, 84.9],
    );
    const east = clip(
      "east",
      "dem-region",
      "nsw-5m",
      [-178.9, 84.8, -178.7, 84.9],
    );
    const [whole, ...routed] = ok(
      resolveMapSource({ kind: "nsw-hillshade" }, offline([west, east], [])),
    );
    expect(whole).toMatchObject({ layerMaxZoom: 15 });
    const readers = (x: number, y: number) =>
      routed.flatMap((r) => {
        const [x0, y0, x1, y1] = tileRectCovering(15, r.tileJson!.bounds!);
        return x >= x0 && x <= x1 && y >= y0 && y <= y1
          ? r.tileJson!.tiles
          : [];
      });
    const a = tileRectCovering(15, west.bbox!);
    const b = tileRectCovering(15, east.bbox!);
    for (const y of [a[1], a[3]]) {
      expect(readers(a[0], y)).toEqual(["pmtiles://file:///maps/west.pmtiles"]);
      expect(readers(b[2], y)).toEqual(["pmtiles://file:///maps/east.pmtiles"]);
      expect(readers(b[0], y)).toHaveLength(1);
      expect(readers(a[2], y)).toHaveLength(1);
      expect(readers(b[2] + 1, y)).toEqual([]);
    }
    for (const r of routed)
      expect(r).toMatchObject({ layerMinZoom: 15, tileJson: { maxzoom: 15 } });
  });

  // Mutation: rank a statewide clip level with an area, and 5 m shading
  // replaces the 1 m shading the user saved.
  it("reads a sharpened area's clip over the statewide clips under it", () => {
    const routed = ok(
      resolveMapSource(
        { kind: "nsw-hillshade" },
        offline([
          clip("s1", "dem-region", "nsw-5m", areaBounds),
          clip("s2", "dem-region", "nsw-5m", areaBounds),
          clip("a", "dem-region", "lidar-area-1", areaBounds),
        ]),
      ),
    ).filter((r) => r.tileJson);
    expect(routed.map((r) => r.tileJson!.tiles)).toEqual([
      ["pmtiles://file:///maps/a.pmtiles"],
    ]);
  });

  // Red if the statewide clip lookup takes an area's clip of the same kind:
  // it would draw over the statewide clip with no routing.
  it("never takes an area's clip for the statewide one", () => {
    const sources = ok(
      resolveMapSource(
        { kind: "nsw-slope" },
        offline([clip("a", "slope-region", "lidar-area-1", areaBounds)], []),
      ),
    );
    expect(sources).toEqual([]);
  });

  // Red if a clip of an area no longer listed is still drawn.
  it("draws no clip of an area the account can no longer see", () => {
    const saved = [
      clip("s", "slope-region", "nsw-5m-slope"),
      clip("a", "slope-region", "lidar-area-1", areaBounds),
    ];
    // Another area is still listed: only area-1 has gone.
    const listed = [{ ...kept, id: "area-2" }];
    expect(
      resolveMapSource({ kind: "nsw-slope" }, offline(saved, listed)),
    ).toEqual(
      resolveMapSource(
        { kind: "nsw-slope" },
        offline(saved.slice(0, 1), listed),
      ),
    );
  });

  // Red if a statewide rectangle reads only one of the saved contour clips
  // (the contours would stop at that clip's edge around the area), or the
  // statewide lookup takes the area's contour clip.
  it("reads every saved statewide contour clip around the area, and the area's z14 clip inside it", () => {
    const sources = ok(
      resolveMapSource(
        { kind: "nsw-contours" },
        offline([
          clip("c1", "contours-region", "nsw-contours"),
          clip("c2", "contours-region", "nsw-contours"),
          clip("ac", "contours-region", "lidar-area-1", areaBounds),
        ]),
      ),
    );
    // The statewide contours below z14 are the statewide clips alone.
    expect(sources.filter((s) => !s.tileJson).map((s) => s.url)).toEqual([
      "pmtiles://file:///maps/c1.pmtiles",
      "pmtiles://file:///maps/c2.pmtiles",
    ]);
    const tiles = sources.flatMap((s) => s.tileJson?.tiles ?? []);
    expect(tiles.filter((t) => t.endsWith("/c1.pmtiles")).length).toBe(
      tiles.filter((t) => t.endsWith("/c2.pmtiles")).length,
    );
    const own = sources.find((s) =>
      s.tileJson?.tiles[0]?.endsWith("/ac.pmtiles"),
    );
    expect(own?.tileJson).toMatchObject({ minzoom: 14, maxzoom: 14 });
  });

  // Red if a statewide rectangle reads a saved clip that doesn't reach it:
  // ten saved regions would mount ten contour sources for every rectangle.
  it("reads only the statewide clips that reach each rectangle", () => {
    const far: MapArtifact["bbox"] = [10, 10, 10.1, 10.1];
    const sources = ok(
      resolveMapSource(
        { kind: "nsw-contours" },
        offline([
          clip("near", "contours-region", "nsw-contours"),
          // Saved far from the area: only a rectangle reaching it reads it.
          clip("far", "contours-region", "nsw-contours", far),
          clip("ac", "contours-region", "lidar-area-1", areaBounds),
        ]),
      ),
    );
    const reading = (name: string) =>
      sources.filter((s) => s.tileJson?.tiles[0]?.endsWith(`/${name}.pmtiles`));
    const meets = (a: readonly number[], b: readonly number[]) =>
      a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]!;
    expect(reading("far").length).toBeGreaterThan(0);
    expect(reading("far").length).toBeLessThan(reading("near").length);
    for (const s of reading("far"))
      expect(meets(s.tileJson!.bounds, far!)).toBe(true);
  });

  // Red if the hillshade leaves the area's saved heights out.
  it("shades the area from its saved heights", () => {
    const sources = ok(
      resolveMapSource(
        { kind: "nsw-hillshade" },
        offline([
          artifact({
            id: "h",
            kind: "dem-region",
            logicalKey: "nsw-5m",
            sourceType: "raster",
            path: "/maps/h.pmtiles",
            bbox: [-179, 84.8, -178.8, 84.9],
            minzoom: 8,
            maxzoom: 15,
          }),
          clip("ah", "dem-region", "lidar-area-1", areaBounds),
        ]),
      ),
    );
    expect(JSON.stringify(sources)).toContain("/maps/ah.pmtiles");
  });
});
