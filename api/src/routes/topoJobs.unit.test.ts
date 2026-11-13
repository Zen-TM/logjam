import { describe, it, expect } from "vitest";

import {
  OWNER_ONLY_TOPO_JOB_FIELDS,
  SHAREE_VISIBLE_TOPO_JOB_FIELDS,
  TOPO_JOB_SELECT,
  serializeTopoJobFor,
  sharpenMark,
} from "./topoJobs";

// The job view is the one place three endpoints agree on what a client may see
// of a TopoJob.
//
// Two rules are load-bearing and both are privacy, not cosmetics: userId never
// leaves the API (a recipient has no business learning the owner's internal
// id), and s3OutputKeys is owner-only (raw bucket keys, and a key can name a
// place).

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
    expect(serializeTopoJobFor(row, OWNER).s3OutputKeys).toEqual(
      row.s3OutputKeys,
    );
    expect(serializeTopoJobFor(row, SHAREE)).not.toHaveProperty("s3OutputKeys");
  });

  it("stamps syncRole on every surface", () => {
    expect(serializeTopoJobFor(row, OWNER).syncRole).toBe("owner");
    expect(serializeTopoJobFor(row, SHAREE).syncRole).toBe("shared");
  });

  it("omits s3OutputKeys entirely when the caller never selected it", () => {
    const { s3OutputKeys: _unused, ...listRow } = row;
    expect(serializeTopoJobFor(listRow, OWNER)).not.toHaveProperty(
      "s3OutputKeys",
    );
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

// The sharee half of the job view is an allow-list too. serializeTopoJobFor
// spreads every selected column, so a column added to TOPO_JOB_SELECT would
// reach every sharee by default; the lists in routes/topoJobs.ts make it a
// decision.
//
// Mutation that turns it red: adding `pipelineMetrics: true` (or any column) to
// TOPO_JOB_SELECT without classifying it, emitting userId or s3OutputKeys to a
// recipient, or dropping a visible column from the view.
describe("what a sharee sees of a job", () => {
  // A row carrying every column a handler can select.
  const everything = Object.fromEntries(
    Object.keys({ ...TOPO_JOB_SELECT, s3OutputKeys: true }).map((key) => [
      key,
      key === "userId" ? OWNER : null,
    ]),
  ) as { userId: string } & Record<string, unknown>;

  it("is exactly the declared fields", () => {
    expect(
      Object.keys(serializeTopoJobFor(everything, SHAREE)).sort(),
      "a job's recipient sees SHAREE_VISIBLE_TOPO_JOB_FIELDS, no more: add " +
        "the column there, or to OWNER_ONLY_TOPO_JOB_FIELDS with the reason, " +
        "in routes/topoJobs.ts",
    ).toEqual([...SHAREE_VISIBLE_TOPO_JOB_FIELDS].sort());
  });

  it("classifies every selected column", () => {
    const classified = new Set([
      ...SHAREE_VISIBLE_TOPO_JOB_FIELDS,
      ...Object.keys(OWNER_ONLY_TOPO_JOB_FIELDS),
    ]);
    expect(
      Object.keys(everything).filter((key) => !classified.has(key)),
      "classify each column in routes/topoJobs.ts: sharee-visible or owner-only",
    ).toEqual([]);
    expect(
      Object.keys(OWNER_ONLY_TOPO_JOB_FIELDS).filter((key) =>
        SHAREE_VISIBLE_TOPO_JOB_FIELDS.includes(key),
      ),
    ).toEqual([]);
  });
});

// Mutation that turns it red: ticking vegetation for a ZIP with no point
// clouds (the worker's legacy vegetation pass has nothing to read).
describe("sharpenMark", () => {
  const ticked = { vegetation: { enabled: true } };

  it("ticks vegetation only when the ZIP has point clouds and the job asks", () => {
    expect(sharpenMark(3, ticked)).toEqual({ v: 1, vegetation: true });
    expect(sharpenMark(0, ticked)).toEqual({ v: 1, vegetation: false });
    expect(sharpenMark(3, { vegetation: { enabled: false } })).toEqual({
      v: 1,
      vegetation: false,
    });
    expect(sharpenMark(3, null)).toEqual({ v: 1, vegetation: false });
  });
});
