import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { ROUTE_ARROW_SDF_URI } from "./routeArrowSdf";
import {
  ARROW_FEATURE_KIND,
  arrowSegmentFeatures,
  routeArrowStyle,
} from "./routeArrowStyle";

/**
 * The arrows sit ON the route line, and whether they do is a property of the
 * IMAGE: MapLibre centres a line-placed symbol on its image, so a mark drawn
 * off-centre inside that image is drawn off-centre on the line — and with
 * `iconKeepUpright` off it rotates with the line, so the error SWAPS SIDES
 * wherever a route doubles back, which reads as jitter rather than as an
 * offset. The `›` glyph this replaced was 2.0px low at the 24px glyph em, half
 * the width of the 3dp line it rides on, and looked exactly that janky.
 *
 * Two things are checked, because the image is generated and a generator can
 * drift from its output: that the committed data URI still decodes to a centred
 * arrowhead, and that re-running the generator reproduces it exactly.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(here, "routeArrowSdf.ts");
const GENERATOR = join(here, "../../scripts/generate-route-arrow-sdf.mjs");

/** MapLibre takes an SDF's shape edge at alpha 191 (0.75), the same convention
 *  fontnik uses for glyphs. */
const EDGE_ALPHA = 191;

/** Decodes the one PNG shape this generator emits: 8-bit RGBA, no interlace,
 *  filter 0 on every row. Enough to read the alpha channel back out. */
function readAlpha(dataUri: string): { width: number; height: number; alpha: Uint8Array } {
  const png = Buffer.from(dataUri.replace(/^data:image\/png;base64,/, ""), "base64");
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("ascii");
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8); // bit depth
      expect(data[9]).toBe(6); // colour type: RGBA
      expect(data[12]).toBe(0); // interlace: none
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0); // filter: none
    for (let x = 0; x < width; x++) {
      alpha[y * width + x] = raw[y * stride + 1 + x * 4 + 3];
    }
  }
  return { width, height, alpha };
}

describe("routeArrowStyle", () => {
  it("draws an SDF image, so a route's own colour can tint it", () => {
    // iconColor/iconHaloColor are IGNORED for an ordinary bitmap, which would
    // silently give every route the same arrow colour.
    const style = routeArrowStyle(["get", "routeColor"]);
    expect(style.iconImage).toBe("route-arrow");
    expect(style.iconColor).toEqual(["get", "routeColor"]);
    expect(ROUTE_ARROW_SDF_URI.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("draws an arrowhead centred in its own image", () => {
    const { width, height, alpha } = readAlpha(ROUTE_ARROW_SDF_URI);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (alpha[y * width + x] < EDGE_ALPHA) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    expect(minX).toBeLessThan(Infinity); // an empty field draws nothing at all

    // Within a pixel of the image centre. Half a pixel is the rasteriser's own
    // rounding; anything more is a shape that will ride beside the line.
    expect(Math.abs((minX + maxX + 1) / 2 - width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs((minY + maxY + 1) / 2 - height / 2)).toBeLessThanOrEqual(1);

    // The field needs room to fall off on every side: MapLibre reads distance
    // out to 8px, and a clipped field is a hard edge with no halo.
    expect(minX).toBeGreaterThanOrEqual(8);
    expect(minY).toBeGreaterThanOrEqual(8);
    expect(width - 1 - maxX).toBeGreaterThanOrEqual(8);
    expect(height - 1 - maxY).toBeGreaterThanOrEqual(8);
  });

  it("is exactly what its generator produces", () => {
    // The committed module is the artifact; the generator is how it stays
    // adjustable. Editing one without re-running the other is the drift this
    // catches.
    const committed = readFileSync(GENERATED, "utf8");
    execFileSync("node", [GENERATOR], { stdio: "pipe" });
    expect(readFileSync(GENERATED, "utf8")).toBe(committed);
  });

  describe("arrowSegmentFeatures", () => {
    const route = [
      [150.4, -33.5],
      [150.5, -33.6],
      [150.6, -33.55],
    ];

    it("splits a route into one line per segment", () => {
      // The split is the whole mechanism: MapLibre starts a line's symbols half
      // a spacing in, so a per-segment line cannot put an arrow on an anchor.
      const features = arrowSegmentFeatures(route, {});
      expect(features).toHaveLength(2);
      expect(features.map((feature) => feature.geometry.coordinates)).toEqual([
        [route[0], route[1]],
        [route[1], route[2]],
      ]);
    });

    it("marks them so the line layers can filter them out", () => {
      // Both layer sets share one source; without the mark, the route would be
      // drawn twice — once whole and once as overlapping segments.
      for (const feature of arrowSegmentFeatures(route, { routeColor: "#fff" })) {
        expect(feature.properties.kind).toBe(ARROW_FEATURE_KIND);
        expect(feature.properties.routeColor).toBe("#fff");
      }
    });

    it("copies the coordinates rather than aliasing the route's", () => {
      // The draft rebuilds this on every drag frame from a live points array.
      const points = [
        [1, 2],
        [3, 4],
      ];
      const [feature] = arrowSegmentFeatures(points, {});
      points[0][0] = 99;
      expect(feature.geometry.coordinates[0][0]).toBe(1);
    });

    it("has nothing to draw on a route that is a single point", () => {
      expect(arrowSegmentFeatures([[1, 2]], {})).toEqual([]);
      expect(arrowSegmentFeatures([], {})).toEqual([]);
    });
  });
});
