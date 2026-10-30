import { describe, it, expect } from "vitest";

import { defsForForeignPlaceTypes, defsForPlaceType } from "../lib/placeTypes";
import prisma from "../services/prisma";

// `defsForForeignPlaceTypes` is `defsForPlaceType` for many types at once, for
// the sync delta. The seed has several owners' types with scoped, all-types
// and system defs, so one batch over every user type covers the cross-owner
// and cross-type mixing. Requires `make dev`.
// Mutation: drop the join check, or the owner check, in the batch's JS filter,
// or change either function's orderBy, and a type's defs differ.
describe("defsForForeignPlaceTypes", () => {
  it("returns, per type, exactly what defsForPlaceType returns for its owner", async () => {
    const types = await prisma.placeType.findMany({
      where: { ownerId: { not: null } },
    });
    expect(types.length).toBeGreaterThan(1);
    const batch = await defsForForeignPlaceTypes(types.map((t) => t.id));
    for (const t of types) {
      expect(batch.get(t.id), t.id).toEqual(
        await defsForPlaceType(t.ownerId!, t.id),
      );
    }
  });
});
