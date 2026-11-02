import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  PLACE_BADGE_URIS,
  PLACE_BADGE_SHARED_IMAGE,
  PLACE_BADGE_VISITED_IMAGE,
} from "./placeBadge.js";
import { SHARED_PLACE_COLOR, VISITED_PLACE_COLOR } from "./placeTypes.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Decodes the 8-bit RGBA, filter-0 PNG the generator emits. */
function pixels(uri: string) {
  const png = Buffer.from(
    uri.replace(/^data:image\/png;base64,/, ""),
    "base64",
  );
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
  return (x: number, y: number) => {
    const o = y * (width * 4 + 1) + 1 + x * 4;
    return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]];
  };
}
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Mutation: change a disc colour in the generator without the constant (or the
// reverse), or swap the two glyphs, and this turns red.
describe("the place badge images", () => {
  const shared = pixels(PLACE_BADGE_URIS[PLACE_BADGE_SHARED_IMAGE]);
  const visited = pixels(PLACE_BADGE_URIS[PLACE_BADGE_VISITED_IMAGE]);

  it("are discs in the status colours, with a white rim and clear corners", () => {
    expect(shared(64, 20).slice(0, 3)).toEqual(rgb(SHARED_PLACE_COLOR));
    expect(visited(64, 20).slice(0, 3)).toEqual(rgb(VISITED_PLACE_COLOR));
    for (const px of [shared, visited]) {
      expect(px(64, 6)).toEqual([255, 255, 255, 255]);
      expect(px(2, 2)[3]).toBe(0);
    }
  });

  it("draw a person for shared and a tick for visited", () => {
    const white = [255, 255, 255, 255];
    expect(shared(64, 50)).toEqual(white); // head
    expect(visited(64, 50)).not.toEqual(white);
    expect(visited(57, 82)).toEqual(white); // the tick's foot
    expect(shared(40, 66)).not.toEqual(white);
  });

  it("are exactly what the generator produces", () => {
    const file = join(here, "placeBadgeImages.ts");
    const committed = readFileSync(file, "utf8");
    execFileSync("node", [
      join(here, "../scripts/generate-place-badge-images.mjs"),
    ]);
    expect(readFileSync(file, "utf8")).toBe(committed);
  });
});
