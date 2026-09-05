import { describe, expect, it } from "vitest";

import { shareMark, sharedWithLabel } from "./shareMark";

const owners = { "canyon-a": "bob", "canyon-b": "carol" };

describe("the two share marks", () => {
  it("names the owner on a row shared WITH the viewer", () => {
    expect(
      shareMark({
        syncRole: "shared",
        sharedCount: null,
        canyonIds: ["canyon-a"],
        ownersByCanyon: owners,
      }),
    ).toEqual({ pill: { label: "From bob", tone: "outline" } });
  });

  it("falls back to the whole phrase, never the bare word, when no owner resolves", () => {
    // The bare "Shared" is what collided with the owner's own fan-out mark.
    // Whatever the mirror is missing, the pill still says which direction.
    for (const canyonIds of [[], [null], ["canyon-unknown"]]) {
      expect(
        shareMark({ syncRole: "shared", sharedCount: null, canyonIds, ownersByCanyon: owners }),
      ).toEqual({ pill: { label: "Shared with you", tone: "outline" } });
    }
  });

  it("takes the first canyon that resolves when a waypoint hangs off several", () => {
    expect(
      shareMark({
        syncRole: "shared",
        sharedCount: null,
        canyonIds: ["canyon-unknown", "canyon-b"],
        ownersByCanyon: owners,
      }).pill?.label,
    ).toBe("From carol");
  });

  it("gives an owned row a COUNT and no pill — the fan-out is a glyph", () => {
    expect(
      shareMark({
        syncRole: "owner",
        sharedCount: 3,
        canyonIds: ["canyon-a"],
        ownersByCanyon: owners,
      }),
    ).toEqual({ sharedWithCount: 3 });
  });

  it("marks nothing on an owned row shared with nobody, or one not yet confirmed", () => {
    // 0 is a real answer ("nobody"), null is "not known yet" — both render bare.
    for (const sharedCount of [0, null]) {
      expect(
        shareMark({ syncRole: "owner", sharedCount, canyonIds: [], ownersByCanyon: owners }),
      ).toEqual({});
    }
  });

  it("never puts both marks on one row", () => {
    // A received row's sharedCount is the server withholding the owner's
    // fan-out; if it ever arrives non-null it must not turn into a glyph that
    // claims the viewer shared someone else's asset.
    const mark = shareMark({
      syncRole: "shared",
      sharedCount: 5,
      canyonIds: ["canyon-a"],
      ownersByCanyon: owners,
    });
    expect(mark.sharedWithCount).toBeUndefined();
    expect(mark.pill).toBeDefined();
  });

  it("counts people in the glyph's screen-reader text", () => {
    expect(sharedWithLabel(1)).toBe("Shared with 1 person");
    expect(sharedWithLabel(3)).toBe("Shared with 3 people");
  });
});
