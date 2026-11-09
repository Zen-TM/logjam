import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { MAP_INK } from "./designTokens.js";
import {
  OVERLAY_LEGENDS,
  overlayAwaitsChoice,
  overlayChoiceLabel,
} from "./overlayLegends.js";
import {
  CARRIERS,
  COVERAGE_HATCH_IMAGE,
  COVERAGE_HATCH_URIS,
  coverageNameOf,
  coverageOpacity,
  drawsCoverage,
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
  // a phone works; leave "external" clear, and an antenna's reach reads as
  // reception for a phone in the hand.
  it("hatches every level but a handset's and leaves that clear", () => {
    expect(coverageOpacity()).toEqual([
      "match",
      ["get", "level"],
      "outdoor",
      0,
      1,
    ]);
  });
});

describe("drawsCoverage", () => {
  // Mutation: ignore the carrier, and a stored "on" from before the pick
  // draws a layer with no network to filter to.
  it("draws only when on and a carrier is picked", () => {
    expect(drawsCoverage(true, "tpg")).toBe(true);
    expect(drawsCoverage(true, null)).toBe(false);
    expect(drawsCoverage(false, "tpg")).toBe(false);
  });
});

describe("coverageNameOf", () => {
  // Mutation: name "external" as reception, or take the first feature found,
  // and a tap on a hatched spot says there is reception.
  it("names the carrier, and reception only where every level found has it", () => {
    expect(coverageNameOf([at("outdoor")], "telstra")).toBe(
      "Telstra: mobile reception",
    );
    expect(coverageNameOf([at("external")], "tpg")).toBe(
      "TPG: no mobile reception",
    );
    expect(coverageNameOf([at("outdoor"), at("none")], "optus")).toBe(
      "Optus: no mobile reception",
    );
  });

  // Mutation: answer with a level for nothing found, and a tap at sea says
  // there is reception.
  it("says nothing where nothing was found", () => {
    expect(coverageNameOf([], "telstra")).toBeNull();
    expect(coverageNameOf([at("unknown")], "telstra")).toBeNull();
  });
});

describe("normalizeCarrier", () => {
  // Mutation: fall back to a carrier, and the overlay draws a network the
  // user never picked; return the stored value unchecked, and a corrupt one
  // filters the layer down to nothing.
  it("keeps a known carrier and nothing else", () => {
    expect(normalizeCarrier("tpg")).toBe("tpg");
    expect(normalizeCarrier("vodafone")).toBeNull();
    expect(normalizeCarrier(null)).toBeNull();
  });
});

describe("the Coverage legend", () => {
  const legend = OVERLAY_LEGENDS.coverage;

  // Mutation: list a row without the hatch, or a second state, and the
  // legend shows something the map never draws.
  it("keys the hatch the map draws, over the light land it is drawn on", () => {
    expect(legend.rows).toEqual([
      {
        label: "No mobile reception",
        colour: MAP_INK.label,
        pattern: COVERAGE_HATCH_URIS[COVERAGE_HATCH_IMAGE],
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

  // Mutation: answer true for a picked carrier, or false for none, and a
  // client draws the switch with no network to draw, or hides it after the
  // pick; answer true for an overlay with no choice, and Land loses its switch.
  it("asks for the carrier, in place of the switch, until one is picked", () => {
    expect(overlayAwaitsChoice(legend, null)).toBe(true);
    expect(overlayAwaitsChoice(legend, "tpg")).toBe(false);
    expect(overlayAwaitsChoice(OVERLAY_LEGENDS.land, null)).toBe(false);
    expect(legend.choice?.choose).toBe("Choose your carrier");
  });
});
