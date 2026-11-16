import { describe, expect, it } from "vitest";

import { mapLayerFor } from "./geoPdfFraming";

// While a GeoPDF's area is framed the map shows the base layer the dialog
// chose (shared/DESIGN.md §11), and goes back to the user's own when framing
// ends. It is a choice computed from the two ids, never a write of the user's
// stored layer: there is nothing to restore, so a cancel cannot leave the
// dialog's layer behind.
//
// Mutation that turns it red: return `framing.layerId` whenever it is set,
// ignoring `active`, or have `mapLayerFor` write the stored layer.
describe("the layer the map draws", () => {
  const user = "protomaps";
  const dialog = "six-topo";
  // Made-up boxes: Katoomba (New South Wales) and open ocean, in no region.
  const view = { north: -33.7, south: -33.76, east: 150.36, west: 150.3 };
  const ocean = { north: -10, south: -10.1, east: -140, west: -140.1 };

  it("is the dialog's while the area is framed", () => {
    expect(mapLayerFor(user, { active: true, layerId: dialog, view })).toBe(
      dialog,
    );
  });

  it("is the user's own again when framing ends, confirmed or cancelled", () => {
    // Both ways out leave `active` false; the handed-over layer may still be
    // remembered, and must not be drawn.
    expect(mapLayerFor(user, { active: false, layerId: dialog, view })).toBe(
      user,
    );
  });

  it("is the user's own when no dialog has chosen", () => {
    expect(mapLayerFor(user, { active: true, layerId: null, view })).toBe(user);
  });

  it("follows the latest pick between visits", () => {
    expect(mapLayerFor(user, { active: true, layerId: dialog, view })).toBe(
      dialog,
    );
    expect(mapLayerFor(user, { active: false, layerId: dialog, view })).toBe(
      user,
    );
    expect(
      mapLayerFor(user, { active: true, layerId: "six-imagery", view }),
    ).toBe("six-imagery");
  });

  // Mutation: return `framing.layerId` unchecked in `mapLayerFor`, and a frame
  // panned off New South Wales stays on the SIX map, which has no tiles there.
  it("is the ground's default once the frame is panned where the dialog's layer has no tiles", () => {
    expect(
      mapLayerFor(user, { active: true, layerId: dialog, view: ocean }),
    ).toBe("osm-topo");
    expect(mapLayerFor(user, { active: true, layerId: dialog, view })).toBe(
      dialog,
    );
  });
});
