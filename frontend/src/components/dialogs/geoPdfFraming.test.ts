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

  it("is the dialog's while the area is framed", () => {
    expect(mapLayerFor(user, { active: true, layerId: dialog })).toBe(dialog);
  });

  it("is the user's own again when framing ends, confirmed or cancelled", () => {
    // Both ways out leave `active` false; the handed-over layer may still be
    // remembered, and must not be drawn.
    expect(mapLayerFor(user, { active: false, layerId: dialog })).toBe(user);
  });

  it("is the user's own when no dialog has chosen", () => {
    expect(mapLayerFor(user, { active: true, layerId: null })).toBe(user);
  });

  it("follows the latest pick between visits", () => {
    expect(mapLayerFor(user, { active: true, layerId: dialog })).toBe(dialog);
    expect(mapLayerFor(user, { active: false, layerId: dialog })).toBe(user);
    expect(mapLayerFor(user, { active: true, layerId: "six-imagery" })).toBe(
      "six-imagery",
    );
  });
});
