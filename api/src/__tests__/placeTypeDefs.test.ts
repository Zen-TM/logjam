import { describe, it, expect } from "vitest";

import { defsForForeignPlaceTypes, defsForPlaceType } from "../lib/placeTypes";
import prisma from "../services/prisma";
import { ALICE_ID } from "./_actors";

// `defsForForeignPlaceTypes` is `defsForPlaceType` for many types at once, for
// the sync delta. One batch over every user type covers cross-owner mixing
// (the seed's owners each have all-types defs); a second alice type, which her
// seeded `access_beta` is not scoped to, covers the join. Requires `make dev`.
// Mutation: drop the join check, or the owner check, in the batch's JS filter,
// or change either function's orderBy, and a type's defs differ.
describe("defsForForeignPlaceTypes", () => {
  it("returns, per type, exactly what defsForPlaceType returns for its owner", async () => {
    const unscoped = await prisma.placeType.create({
      data: {
        ownerId: ALICE_ID,
        name: "Plan guard second type",
        iconKey: "marker",
        color: "#888888",
      },
    });
    try {
      const types = await prisma.placeType.findMany({
        where: { ownerId: { not: null } },
      });
      const batch = await defsForForeignPlaceTypes(types.map((t) => t.id));
      for (const t of types) {
        expect(batch.get(t.id), t.id).toEqual(
          await defsForPlaceType(t.ownerId!, t.id),
        );
      }
      const keys = (id: string) => batch.get(id)?.map((d) => d.key) ?? [];
      expect(types.some((t) => keys(t.id).includes("access_beta"))).toBe(true);
      expect(keys(unscoped.id)).not.toContain("access_beta");
    } finally {
      await prisma.placeType.delete({ where: { id: unscoped.id } });
    }
  });
});
