import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_SQL } from "../offline/schema";

let sqlite: DatabaseSync;
vi.mock("../offline/registryDb", () => ({
  getOfflineDb: async () => ({
    runAsync: async (sql: string, ...params: (string | null)[]) => {
      sqlite.prepare(sql).run(...params);
    },
    getFirstAsync: async (sql: string) => sqlite.prepare(sql).get() ?? null,
  }),
}));

const { readRouteDraft, saveRouteDraft } = await import("./routeDraftStore");

const points: [number, number][] = [
  [150.4, -33.5],
  [150.41, -33.51],
];

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(SCHEMA_SQL);
});

describe("the stored route draft", () => {
  // Mutation: leave `planId` out of the INSERT, and a draft drawn for a plan
  // comes back after a kill as an account route that Save writes to Saved.
  it("keeps the plan it is being drawn for", async () => {
    await saveRouteDraft({
      points,
      anchors: [0, 1],
      editingRouteId: null,
      planId: "plan-1",
    });
    expect(await readRouteDraft()).toEqual({
      points,
      anchors: [0, 1],
      editingRouteId: null,
      planId: "plan-1",
    });
  });

  // Mutation: leave `planId` out of the ON CONFLICT update, and a later save
  // of the same draft keeps the plan it had before.
  it("forgets the plan once the draft is saved without one", async () => {
    const base = { points, anchors: [0, 1], editingRouteId: null };
    await saveRouteDraft({ ...base, planId: "plan-1" });
    await saveRouteDraft({ ...base, planId: null });
    expect((await readRouteDraft())?.planId).toBeNull();
  });
});
