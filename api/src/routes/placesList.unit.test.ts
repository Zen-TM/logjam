import { describe, it, expect, vi } from "vitest";

// The route module builds a Prisma client at import time, so it is mocked; the
// owned-list tests drive the two groupBy counts through the mock.
vi.mock("../services/prisma", () => ({
  default: {
    place: { findMany: vi.fn(), count: vi.fn() },
    tripLogPlace: { groupBy: vi.fn() },
    placeShare: { groupBy: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { withPlaceListCounts } from "./places";

// The privacy boundary of the place LIST payload (hybrid share model).
//
// `GET /places` and `GET /places/shared` share one fetch helper. Attaching
// `_count: { tripLogLinks, shares }` to the shared list would expose how many
// trips the owner has logged (cardinality of the owner-private trip list) and
// how many other people the owner shared it with (their share fan-out).
//
// Relying on clients to decline rendering the count is not a security boundary;
// any client or devtools inspection would expose it.
//
// These are unit tests because the boundary is the scope branch in
// withPlaceListCounts: no server, no DB, so they run in the gate that the
// integration suite doesn't.

describe("withPlaceListCounts — owned list", () => {
  it("counts trips and shares per row, zero when none", async () => {
    vi.mocked(prisma.tripLogPlace.groupBy).mockResolvedValue([
      { placeId: "a", _count: { _all: 2 } },
    ] as never);
    vi.mocked(prisma.placeShare.groupBy).mockResolvedValue([
      { placeId: "b", _count: { _all: 3 } },
    ] as never);
    expect(
      await withPlaceListCounts("owned", [{ id: "a" }, { id: "b" }]),
    ).toEqual([
      { id: "a", _count: { tripLogLinks: 2, shares: 0 } },
      { id: "b", _count: { tripLogLinks: 0, shares: 3 } },
    ]);
  });
});

describe("withPlaceListCounts — shared list (the boundary)", () => {
  // The load-bearing assertion: nothing counted means nothing to leak.
  it("attaches no _count and queries nothing", async () => {
    vi.mocked(prisma.tripLogPlace.groupBy).mockClear();
    vi.mocked(prisma.placeShare.groupBy).mockClear();
    const rows = await withPlaceListCounts("shared", [{ id: "a" }]);
    expect(rows).toEqual([{ id: "a" }]);
    expect(prisma.tripLogPlace.groupBy).not.toHaveBeenCalled();
    expect(prisma.placeShare.groupBy).not.toHaveBeenCalled();
  });
});
