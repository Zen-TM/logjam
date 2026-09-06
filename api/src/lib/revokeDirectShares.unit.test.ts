import { describe, it, expect } from "vitest";
import { SHARABLE_ENTITY_TYPES, SYNC_ENTITY_TYPES } from "@logjam/shared";

import {
  revocationKey,
  revocationsNeedingTombstones,
  syncedEntityType,
  type DirectShareRevocation,
} from "./revokeDirectShares";

const ROUTE: DirectShareRevocation = {
  entityType: "route",
  entityId: "r1",
  sharedWithId: "bob",
};
const OTHER_ROUTE: DirectShareRevocation = {
  entityType: "route",
  entityId: "r2",
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
  it("tombstones every route with no surviving path", () => {
    expect(
      revocationsNeedingTombstones([OTHER_ROUTE, ROUTE], new Set()),
    ).toEqual([OTHER_ROUTE, ROUTE]);
  });

  // The direct arm goes, the place arm stays: the recipient still sees it
  // through a place its owner shared, so it must NOT be told to forget it.
  it("skips a row the recipient still sees through a shared place", () => {
    expect(
      revocationsNeedingTombstones(
        [OTHER_ROUTE, ROUTE],
        new Set([revocationKey(OTHER_ROUTE)]),
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
    const carol = { ...ROUTE, sharedWithId: "carol" };
    expect(
      revocationsNeedingTombstones(
        [ROUTE, carol],
        new Set([revocationKey(carol)]),
      ),
    ).toEqual([ROUTE]);
  });
});

// Read against the two vocabularies THEMSELVES rather than against a list
// retyped here: this function is the join between "what can be shared
// directly" and "what rides delta sync", so a kind that joins both lists and
// not this function is exactly the drift worth catching. Asserting my own
// constant back at myself would pass through that change untouched.
describe("syncedEntityType", () => {
  it("admits a sharable kind exactly when delta sync carries it", () => {
    const synced = new Set<string>(SYNC_ENTITY_TYPES);
    for (const entityType of SHARABLE_ENTITY_TYPES) {
      expect(syncedEntityType(entityType), entityType).toBe(
        synced.has(entityType) ? entityType : null,
      );
    }
  });

  it("is not vacuous — something is sharable and synced, something is not", () => {
    const admitted = SHARABLE_ENTITY_TYPES.filter(
      (entityType) => syncedEntityType(entityType) !== null,
    );
    expect(admitted.length).toBeGreaterThan(0);
    expect(admitted.length).toBeLessThan(SHARABLE_ENTITY_TYPES.length);
  });
});

describe("revocationKey", () => {
  it("separates the same id shared with two people", () => {
    expect(revocationKey(ROUTE)).not.toBe(
      revocationKey({ ...ROUTE, sharedWithId: "carol" }),
    );
  });

  it("separates the same id in two tables", () => {
    expect(revocationKey({ ...ROUTE, entityType: "topoJob" })).not.toBe(
      revocationKey(ROUTE),
    );
  });
});
