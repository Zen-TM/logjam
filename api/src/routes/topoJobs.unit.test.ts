import { describe, it, expect } from "vitest";

import { TOPO_JOB_SELECT, serializeTopoJobFor } from "./topoJobs";

// The job view is the one place three endpoints agree on what a client may see
// of a TopoJob. Before it existed each stripped fields by hand and they had
// already drifted: the detail endpoint stamped no syncRole, so a client polling
// a shared job could not tell from that response it was read-only.
//
// Two rules are load-bearing and both are privacy, not cosmetics: userId never
// leaves the API (a recipient has no business learning the owner's internal
// id), and s3OutputKeys is owner-only (raw bucket keys, and a key can name a
// canyon).

const OWNER = "user-owner";
const SHAREE = "user-sharee";

const row = {
  id: "job-1",
  userId: OWNER,
  status: "complete",
  name: "Kanangra",
  footprint: null,
  tileCount: 4,
  estimatedSeconds: 120,
  layerOptions: ["hillshade"],
  errorMessage: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-02T00:00:00Z"),
  s3OutputKeys: [{ name: "hillshade", cogKey: "k", pmtilesKey: "p" }],
};

describe("serializeTopoJobFor", () => {
  it("never emits userId, to the owner or to a recipient", () => {
    expect(serializeTopoJobFor(row, OWNER)).not.toHaveProperty("userId");
    expect(serializeTopoJobFor(row, SHAREE)).not.toHaveProperty("userId");
  });

  it("gives s3OutputKeys to the owner and withholds it from a recipient", () => {
    expect(serializeTopoJobFor(row, OWNER).s3OutputKeys).toEqual(row.s3OutputKeys);
    expect(serializeTopoJobFor(row, SHAREE)).not.toHaveProperty("s3OutputKeys");
  });

  it("stamps syncRole on EVERY surface — the drift that made this exist", () => {
    expect(serializeTopoJobFor(row, OWNER).syncRole).toBe("owner");
    expect(serializeTopoJobFor(row, SHAREE).syncRole).toBe("shared");
  });

  it("omits s3OutputKeys entirely when the caller never selected it", () => {
    const { s3OutputKeys: _unused, ...listRow } = row;
    expect(serializeTopoJobFor(listRow, OWNER)).not.toHaveProperty("s3OutputKeys");
  });

  // The parallel-list guard: TOPO_JOB_SELECT decides what is read, the
  // serializer decides what is emitted. A column added to the select must show
  // up here (or be deliberately stripped like userId) rather than silently
  // vanishing from every response.
  it("emits every selected column except the two it deliberately withholds", () => {
    const emitted = new Set(Object.keys(serializeTopoJobFor(row, OWNER)));
    for (const column of Object.keys(TOPO_JOB_SELECT)) {
      if (column === "userId") {
        expect(emitted.has(column)).toBe(false);
        continue;
      }
      expect(emitted.has(column)).toBe(true);
    }
  });
});
