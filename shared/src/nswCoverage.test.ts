import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { MAP_INK } from "./designTokens.js";
import { OVERLAY_LEGENDS, overlayChoiceLabel } from "./overlayLegends.js";
import {
  CARRIERS,
  COVERAGE_HATCH_DENSE_IMAGE,
  COVERAGE_HATCH_LIGHT_IMAGE,
  COVERAGE_HATCH_URIS,
  COVERAGE_LEVELS,
  coverageNameOf,
  coverageOpacity,
  coveragePattern,
  DEFAULT_CARRIER,
  normalizeCarrier,
  NSW_COVERAGE,
} from "./nswCoverage.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The 8-bit RGBA, filter-0 PNG the generator writes, as rows of pixels. */
function decode(uri: string) {
  const png = Buffer.from(uri.split(",")[1]!, "base64");
  let at = 8;
  let width = 0;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString("ascii");
    if (type === "IHDR") width = png.readUInt32BE(at + 8);
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const px = (x: number, y: number) => {
    const o = y * (width * 4 + 1) + 1 + x * 4;
    return [raw[o]!, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!];
  };
  return { width, px };
}

/** How much of the tile the lines cover, 0 to 1. */
function ink(uri: string) {
  const { width, px } = decode(uri);
  let alpha = 0;
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) alpha += px(x, y)[3]!;
  return alpha / (255 * width * width);
}

const at = (level: string) => ({
  properties: { [NSW_COVERAGE.levelProperty]: level },
});

describe("the Coverage hatches", () => {
  // Mutation: edit coverageHatchImages.ts by hand, or change the generator
  // without rerunning it, and the committed hatch drifts from its source.
  it("are exactly what the generator produces", () => {
    const file = join(here, "coverageHatchImages.ts");
    const committed = readFileSync(file, "utf8");
    execFileSync("node", [
      join(here, "../scripts/generate-coverage-hatch-images.mjs"),
    ]);
    expect(readFileSync(file, "utf8")).toBe(committed);
  });

  // Mutation: change the generator's inks alone, and the hatch stops being a
  // dark core edged in light, which reads on light ground and on imagery.
  it("draw a casing-coloured core edged in the map's label colour", () => {
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const uri of Object.values(COVERAGE_HATCH_URIS)) {
      const { px } = decode(uri);
      expect(px(0, 0).slice(0, 3)).toEqual(rgb(MAP_INK.casing)); // on a line
      expect(px(3, 0).slice(0, 3)).toEqual(rgb(MAP_INK.label)); // beside it
    }
  });

  // Mutation: swap the two images, and "no coverage" draws lighter than
  // "external antenna only".
  it("draw no coverage denser than an antenna's reach", () => {
    expect(
      ink(COVERAGE_HATCH_URIS[COVERAGE_HATCH_DENSE_IMAGE]),
    ).toBeGreaterThan(2 * ink(COVERAGE_HATCH_URIS[COVERAGE_HATCH_LIGHT_IMAGE]));
  });

  // Mutation: let a line run off one edge and not come in at the opposite one
  // (a spacing that doesn't divide the tile), and the map draws a grid.
  it("tile without a seam", () => {
    for (const uri of Object.values(COVERAGE_HATCH_URIS)) {
      const { width, px } = decode(uri);
      for (let i = 0; i < width; i++) {
        expect(px(0, i)).toEqual(px(width - 1, (i + 1) % width));
        expect(px(i, 0)).toEqual(px((i + 1) % width, width - 1));
      }
    }
  });
});

describe("the Coverage layer's paint", () => {
  // Mutation: hatch the "outdoor" level, and the whole state is hatched where
  // a phone works; drop it from the layer, and a tap there answers nothing.
  it("draws each gap's hatch and leaves handset coverage clear", () => {
    const pattern = coveragePattern();
    const opacity = coverageOpacity();
    expect(pattern).toEqual([
      "match",
      ["get", "level"],
      "external",
      COVERAGE_HATCH_LIGHT_IMAGE,
      "none",
      COVERAGE_HATCH_DENSE_IMAGE,
      COVERAGE_HATCH_LIGHT_IMAGE,
    ]);
    expect(opacity).toEqual([
      "match",
      ["get", "level"],
      ["external", "none"],
      1,
      0,
    ]);
    expect(COVERAGE_LEVELS.map((l) => l.level)).toEqual([
      "outdoor",
      "external",
      "none",
    ]);
  });
});

describe("coverageNameOf", () => {
  // Mutation: take the first feature found, and a tap on the line between two
  // levels can promise a signal the other side doesn't have.
  it("names the carrier and the worse level found", () => {
    expect(coverageNameOf([at("outdoor")], "telstra")).toBe(
      "Telstra: handset outdoors",
    );
    expect(coverageNameOf([at("none"), at("external")], "tpg")).toBe(
      "TPG: no predicted coverage",
    );
    expect(coverageNameOf([at("outdoor"), at("external")], "optus")).toBe(
      "Optus: external antenna only",
    );
  });

  // Mutation: answer with a level for nothing found, and a tap at sea says
  // there is coverage.
  it("says nothing where nothing was found", () => {
    expect(coverageNameOf([], "telstra")).toBeNull();
    expect(coverageNameOf([at("unknown")], "telstra")).toBeNull();
  });
});

describe("normalizeCarrier", () => {
  // Mutation: return the stored value unchecked, and an older build's or a
  // corrupt value filters the layer down to nothing.
  it("keeps a known carrier and defaults the rest", () => {
    expect(normalizeCarrier("tpg")).toBe("tpg");
    expect(normalizeCarrier("vodafone")).toBe(DEFAULT_CARRIER);
    expect(normalizeCarrier(null)).toBe(DEFAULT_CARRIER);
  });
});

describe("the Coverage legend", () => {
  const legend = OVERLAY_LEGENDS.coverage;

  // Mutation: list a row without its hatch, or the handset level, and the
  // legend shows a colour the map never draws.
  it("keys each hatch the map draws, over the light land it is drawn on", () => {
    expect(legend.rows).toEqual([
      {
        label: "External antenna only",
        colour: MAP_INK.label,
        pattern: COVERAGE_HATCH_URIS[COVERAGE_HATCH_LIGHT_IMAGE],
      },
      {
        label: "No predicted coverage",
        colour: MAP_INK.label,
        pattern: COVERAGE_HATCH_URIS[COVERAGE_HATCH_DENSE_IMAGE],
      },
    ]);
  });

  // Mutation: drop a carrier from the choice, and its users can't pick it;
  // name the row's subtitle from anything else, and it can name another.
  it("offers every carrier and names the chosen one", () => {
    expect(legend.choice?.options.map((o) => o.value)).toEqual(
      CARRIERS.map((c) => c.id),
    );
    expect(overlayChoiceLabel(legend, "tpg")).toBe("TPG");
    expect(overlayChoiceLabel(OVERLAY_LEGENDS.land, "tpg")).toBeUndefined();
  });
});
