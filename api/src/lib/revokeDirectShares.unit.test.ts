import { describe, it, expect } from "vitest";

import {
  revocationKey,
  revocationsNeedingTombstones,
  syncedEntityType,
  type DirectShareRevocation,
} from "./revokeDirectShares";

const WAYPOINT: DirectShareRevocation = {
  entityType: "waypoint",
  entityId: "w1",
  sharedWithId: "bob",
};
const ROUTE: DirectShareRevocation = {
  entityType: "route",
  entityId: "r1",
  sharedWithId: "bob",
};
const TOPO: DirectShareRevocation = {
  entityType: "topoJob",
  entityId: "t1",
  sharedWithId: "bob",
};
const GEO_PDF: DirectShareRevocation = {
  entityType: "geoPdfJob",
  entityId: "g1",
  sharedWithId: "bob",
};

// The invariant: a tombstone tells a recipient's mirror to FORGET a row. Writing
// one where another path to the row survives makes the row flicker out and back
// on every delta pull; withholding one where no path survives leaves it in the
// mirror forever. Both failures are invisible in a passing revoke.
describe("revocationsNeedingTombstones", () => {
  it("tombstones a waypoint and a route with no surviving path", () => {
    expect(revocationsNeedingTombstones([WAYPOINT, ROUTE], new Set())).toEqual([
      WAYPOINT,
      ROUTE,
    ]);
  });

  // The direct arm goes, the canyon arm stays: the recipient still sees it
  // through a canyon its owner shared, so it must NOT be told to forget it.
  it("skips a row the recipient still sees through a shared canyon", () => {
    expect(
      revocationsNeedingTombstones(
        [WAYPOINT, ROUTE],
        new Set([revocationKey(WAYPOINT)]),
      ),
    ).toEqual([ROUTE]);
  });

  // Jobs are not delta-synced at all — their lists refetch, so there is no
  // mirror row to tombstone and writing one would name an entity type sync
  // does not carry.
  it("never tombstones a topo or GeoPDF job", () => {
    expect(revocationsNeedingTombstones([TOPO, GEO_PDF], new Set())).toEqual([]);
  });

  it("keys per recipient, so one friend's surviving path spares only theirs", () => {
    const carol = { ...WAYPOINT, sharedWithId: "carol" };
    expect(
      revocationsNeedingTombstones(
        [WAYPOINT, carol],
        new Set([revocationKey(carol)]),
      ),
    ).toEqual([WAYPOINT]);
  });
});

describe("syncedEntityType", () => {
  it("admits exactly the two delta-synced kinds", () => {
    expect(syncedEntityType("waypoint")).toBe("waypoint");
    expect(syncedEntityType("route")).toBe("route");
    expect(syncedEntityType("topoJob")).toBeNull();
    expect(syncedEntityType("geoPdfJob")).toBeNull();
  });
});

describe("revocationKey", () => {
  it("separates the same id shared with two people", () => {
    expect(revocationKey(WAYPOINT)).not.toBe(
      revocationKey({ ...WAYPOINT, sharedWithId: "carol" }),
    );
  });

  it("separates the same id in two tables", () => {
    expect(revocationKey({ ...WAYPOINT, entityType: "route" })).not.toBe(
      revocationKey(WAYPOINT),
    );
  });
});
