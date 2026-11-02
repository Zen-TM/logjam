import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const map = readFileSync(join(__dirname, "Map.tsx"), "utf8");
const control = readFileSync(
  join(__dirname, "../../ui/MapControl.module.css"),
  "utf8",
);

describe("the map's marks and chrome", () => {
  // Mutation: type `"text-size": 12` into any label layer in Map.tsx, and the
  // two clients' label sizes can drift apart again.
  it("takes a label's size from MAP_LABEL_SIZE", () => {
    expect(map).not.toMatch(/"text-size":\s*\d/);
  });

  // Mutation: delete the halo layers, or the showPlaces loop over them, and a
  // pin loses its white ring on a dark basemap, or the ring stays when Places
  // is hidden.
  it("draws a white halo under each pin and hides it with Places", () => {
    for (const id of ["place-halo", "shared-place-halo"]) {
      expect(map).toContain(`"${id}"`);
    }
    expect(map).toMatch(
      /for \(const id of \["place-halo", "shared-place-halo"\]\)\s+mapRef\.current\.setLayoutProperty\(id, "visibility"/,
    );
  });

  // Mutation: add the halo layers after `place-circles` in Map.tsx, and a white
  // disc covers every pin.
  it("adds both halos before either pin", () => {
    const at = (id: string) => map.indexOf(`id: "${id}"`);
    const haloLoop = map.indexOf('["place-halo", "places"]');
    expect(haloLoop).toBeGreaterThan(-1);
    expect(haloLoop).toBeLessThan(at("place-circles"));
    expect(haloLoop).toBeLessThan(at("shared-place-circles"));
  });

  // Mutation: delete `.group::after`, and the zoom group loses its edge under
  // its opaque buttons; drop the attribution button's `background-color:
  // transparent`, and MapLibre's pale disc sits under the glyph on a dark scheme.
  it("edges a button group over its buttons and clears the credits button", () => {
    expect(control).toMatch(
      /\.group::after\s*{[^}]*inset 0 0 0 1px var\(--color-line\)/,
    );
    expect(control).toMatch(
      /maplibregl-ctrl-attrib \.maplibregl-ctrl-attrib-button\)\s*{[^}]*background-color: transparent/,
    );
  });

  // Mutation: set `.mapButton` back to `var(--color-page)`, and the map's
  // buttons stop matching Logjam GPS's card.
  it("fills a map button with the card colour and its edge", () => {
    expect(control).not.toContain("background: var(--color-page)");
    expect(control).toContain("var(--shadow-map-card)");
  });
});
