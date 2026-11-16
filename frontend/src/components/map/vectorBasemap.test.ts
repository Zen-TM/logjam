import { NSW_REGION, SIM_NZ, SIM_UTAH, SIM_WORLD } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import {
  initialVectorArchive,
  snapUrlFor,
  vectorSourceUrl,
  vectorStyleLayers,
} from "./vectorBasemap";

const ORIGIN = "https://app.example";
const inNsw = { west: 150.2, south: -33.8, east: 150.4, north: -33.6 };
const inNz = { west: 169.2, south: -44.1, east: 169.3, north: -44.0 };
const atSea = { west: 159.9, south: -40.1, east: 160.1, north: -39.9 };

describe("vectorSourceUrl", () => {
  // Mutation: drop the pmtiles:// scheme from `vectorSourceUrl`, and MapLibre
  // fetches the archive as TileJSON; and the source over NSW is today's.
  it("is today's source over NSW", () => {
    expect(vectorSourceUrl(NSW_REGION.vector!, ORIGIN)).toBe(
      `pmtiles://${ORIGIN}/master/basemap/protomaps-nsw.pmtiles`,
    );
  });
});

describe("initialVectorArchive", () => {
  const regions = [NSW_REGION, SIM_NZ, SIM_UTAH];

  // Mutation: return the first archive whatever the view, and a map opened in
  // simulated New Zealand creates its source on NSW's archive.
  it("is the archive of the region in view", () => {
    expect(initialVectorArchive(inNsw, regions)).toBe(NSW_REGION.vector);
    expect(initialVectorArchive(inNz, regions)).toBe(SIM_NZ.vector);
  });

  // Mutation: throw where the view has no archive, and a map opened over the
  // sea never finishes loading.
  it("is the first any region declares where the view has none", () => {
    expect(initialVectorArchive(atSea, regions)).toBe(NSW_REGION.vector);
  });

  // Mutation: skip the `world` argument, and a map opened where only the
  // world declares an archive starts on a region's.
  it("is the world's where no region is in view and it declares one", () => {
    expect(initialVectorArchive(atSea, regions, SIM_WORLD)).toBe(
      SIM_WORLD.vector,
    );
  });
});

describe("snapUrlFor", () => {
  // Mutation: drop the origin from the URL, and snapping reads an archive path
  // no host serves; over NSW it is the archive it always read.
  it("is the NSW archive on this origin for a segment in NSW", () => {
    expect(snapUrlFor([150.3, -33.7], [150.31, -33.71], ORIGIN)).toBe(
      `${ORIGIN}/master/basemap/protomaps-nsw.pmtiles`,
    );
  });

  // Mutation: fall back to NSW's archive for a segment outside every region,
  // and snapping outside NSW reads an archive with no ways there.
  it("is none for a segment outside every region", () => {
    expect(snapUrlFor([169.25, -44.06], [169.26, -44.05], ORIGIN)).toBeNull();
  });
});

describe("vectorStyleLayers", () => {
  const text = (layers: ReturnType<typeof vectorStyleLayers>) =>
    JSON.stringify(layers);

  // Mutation: hard-code "en" in `vectorStyleLayers`, and a caller that names
  // another language still draws English labels.
  it("labels in the language asked for, English by default", () => {
    expect(text(vectorStyleLayers("protomaps"))).toContain("name:en");
    expect(text(vectorStyleLayers("protomaps"))).not.toContain("name:fr");
    expect(text(vectorStyleLayers("protomaps", "fr"))).toContain("name:fr");
  });

  // Mutation: bind the layers to a fixed source id, and the source the map
  // adds is not the one they read.
  it("binds every layer with a source to the one it is given", () => {
    const bound = vectorStyleLayers("mine").flatMap((layer) =>
      "source" in layer ? [layer.source] : [],
    );
    expect(bound.length).toBeGreaterThan(0);
    expect(new Set(bound)).toEqual(new Set(["mine"]));
  });
});
