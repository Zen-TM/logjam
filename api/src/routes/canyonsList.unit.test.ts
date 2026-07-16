import { describe, it, expect, vi } from "vitest";

// The route module builds a Prisma client at import time; the include helper
// under test is pure, so the client is stubbed out entirely.
vi.mock("../services/prisma", () => ({
  default: { canyon: { findMany: vi.fn(), count: vi.fn() } },
}));

import { canyonListInclude } from "./canyons";

// The privacy boundary of the canyon LIST payload (hybrid share model).
//
// `GET /canyons` and `GET /canyons/shared` share one fetch helper. It used to
// attach `_count: { tripLogLinks, shares }` unconditionally, so every recipient
// learned, per shared canyon, how many trips the owner had logged on it (the
// cardinality of the owner-private trip list) and how many OTHER people the
// owner had shared it with (their share fan-out).
//
// shareBoundary.test.ts asserts the trip *list* never attaches to a shared
// canyon, and passes — the count slipped past that assertion. The frontend
// declined to render it, which is not a boundary: anyone with devtools, or any
// future client, saw it.
//
// These are unit tests because the leak lives in a pure include-shape decision:
// no server, no DB, so they run in the gate that the integration suite doesn't.

describe("canyonListInclude — owned list", () => {
  it("counts trips and shares (the owner's own data)", () => {
    expect(canyonListInclude("owned")).toEqual({
      _count: { select: { tripLogLinks: true, shares: true } },
    });
  });
});

describe("canyonListInclude — shared list (the boundary)", () => {
  // The load-bearing assertion: nothing to serialise means nothing to leak.
  it("attaches no include at all", () => {
    expect(canyonListInclude("shared")).toBeUndefined();
  });

  it("never counts tripLogLinks — that is the owner-private trip list's cardinality", () => {
    expect(canyonListInclude("shared")?._count).toBeUndefined();
  });

  it("never counts shares — that is the owner's share fan-out to other people", () => {
    // Guards the narrower regression of dropping only tripLogLinks and keeping
    // shares, which would still expose who-else-can-see-this to a sharee.
    expect(JSON.stringify(canyonListInclude("shared") ?? {})).not.toContain(
      "shares",
    );
  });

  // The two scopes must not converge: a refactor that made the shared list
  // reuse the owned include would silently reinstate the leak.
  it("is not the owned include", () => {
    expect(canyonListInclude("shared")).not.toEqual(canyonListInclude("owned"));
  });
});
