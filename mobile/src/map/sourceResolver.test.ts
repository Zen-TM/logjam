import { describe, it, expect } from "vitest";
import {
  resolveMapSource,
  hashKey,
  type MapArtifact,
  type ResolveContext,
} from "./sourceResolver";

const CDN = "https://logjamnsw.com";

function ctx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return { connectivity: "online", artifacts: [], cdnBaseUrl: CDN, ...overrides };
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
    const [r] = resolveMapSource({ kind: "basemap", basemapId: "six-topo" }, ctx());
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
    expect(r).toMatchObject({ status: "unavailable", reason: "online-only-source" });
  });

  it("offline: offline-capable basemap without downloads is unavailable (no silent remote fallback)", () => {
    const [r] = resolveMapSource(
      { kind: "basemap", basemapId: "six-topo" },
      ctx({ connectivity: "offline" }),
    );
    expect(r).toMatchObject({ status: "unavailable", reason: "offline-not-downloaded" });
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
          artifact({ kind: "basemap-region", logicalKey: "six-topo", bbox: [1, 2, 3, 4] }),
        ],
      }),
    );
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.origin).toBe("remote");
  });

  it("throws loudly on an unknown basemap id", () => {
    expect(() =>
      resolveMapSource(
        { kind: "basemap", basemapId: "bogus" as never },
        ctx(),
      ),
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
    const [b] = resolveMapSource({ ...ref, remoteUrl: `${ref.remoteUrl}2` }, ctx());
    expect(a.key).not.toBe(b.key);
  });

  it("online with an expired/absent remote URL: unavailable no-remote-url", () => {
    const [r] = resolveMapSource({ ...ref, remoteUrl: null }, ctx());
    expect(r).toMatchObject({ status: "unavailable", reason: "no-remote-url" });
  });

  it("offline without a download: unavailable", () => {
    const [r] = resolveMapSource(ref, ctx({ connectivity: "offline" }));
    expect(r).toMatchObject({ status: "unavailable", reason: "offline-not-downloaded" });
  });

  it("mbtiles artifacts ride `tiles`, pmtiles ride `url`", () => {
    const [r] = resolveMapSource(
      ref,
      ctx({
        artifacts: [
          artifact({ logicalKey: "job1/hillshade", format: "mbtiles", path: "/files/x.mbtiles" }),
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
    const [r] = resolveMapSource({ kind: "vector-import", importId: "nope" }, ctx());
    expect(r.status).toBe("unavailable");
  });
});

describe("hashKey", () => {
  it("is deterministic and distinguishes different URLs", () => {
    expect(hashKey("abc")).toBe(hashKey("abc"));
    expect(hashKey("abc")).not.toBe(hashKey("abd"));
  });
});
