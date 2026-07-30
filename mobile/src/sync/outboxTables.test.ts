import { describe, expect, it } from "vitest";
import { SYNC_PUSH_OPS_BY_ENTITY } from "@logjam/shared";

import {
  OUTBOX_ENTITIES,
  isOutboxEntity,
  outboxMirrorTable,
  shelvesDiscardedFields,
  type OutboxEntity,
} from "./outboxTables";

describe("OUTBOX_ENTITIES", () => {
  it("covers every sync-protocol entity plus media", () => {
    // media rides the outbox but is absent from SYNC_PUSH_OPS_BY_ENTITY, which is
    // exactly how it fell through the old mapping.
    for (const entity of Object.keys(SYNC_PUSH_OPS_BY_ENTITY)) {
      expect(OUTBOX_ENTITIES).toContain(entity);
    }
    expect(OUTBOX_ENTITIES).toContain("media");
  });
});

describe("outboxMirrorTable", () => {
  it("answers for EVERY outbox entity", () => {
    // The regression this file exists for: a missing case returned undefined,
    // which built `DELETE FROM undefined`, threw inside the discard transaction,
    // rolled it back, and left the Discard button with no visible effect.
    for (const entity of OUTBOX_ENTITIES) {
      const table = outboxMirrorTable(entity);
      expect(table === null || (typeof table === "string" && table.length > 0)).toBe(true);
    }
  });

  it("maps the tables a create can orphan", () => {
    expect(outboxMirrorTable("canyon")).toBe("canyons");
    expect(outboxMirrorTable("tripLog")).toBe("trip_logs");
    expect(outboxMirrorTable("waypoint")).toBe("waypoints");
    expect(outboxMirrorTable("media")).toBe("media");
  });

  it("returns null for notifications rather than a table with no id column", () => {
    expect(outboxMirrorTable("notification")).toBeNull();
  });
});

describe("isOutboxEntity", () => {
  it("accepts what the outbox holds and rejects the rest", () => {
    expect(isOutboxEntity("media")).toBe(true);
    expect(isOutboxEntity("canyon")).toBe(true);
    expect(isOutboxEntity("canyons")).toBe(false);
    expect(isOutboxEntity("")).toBe(false);
  });
});

describe("shelvesDiscardedFields", () => {
  it("shelves the user's typing, not a media op's bookkeeping", () => {
    expect(shelvesDiscardedFields("canyon")).toBe(true);
    expect(shelvesDiscardedFields("tripLog")).toBe(true);
    // A filename, a byte count and two cache paths about to be deleted.
    expect(shelvesDiscardedFields("media")).toBe(false);
  });

  it("has an answer for every entity", () => {
    for (const entity of OUTBOX_ENTITIES as OutboxEntity[]) {
      expect(typeof shelvesDiscardedFields(entity)).toBe("boolean");
    }
  });
});
