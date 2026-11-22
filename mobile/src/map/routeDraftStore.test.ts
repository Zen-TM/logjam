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

const base = { points, anchors: [0, 1], editingRouteId: null };

describe("the stored route draft", () => {
  // Mutation: leave `planId` out of the INSERT, and a draft drawn for a plan
  // comes back after a kill as an account route that Save writes to Saved.
  it("keeps the plan it is being drawn for", async () => {
    await saveRouteDraft({ ...base, planId: "plan-1", placeId: null });
    expect(await readRouteDraft()).toEqual({
      ...base,
      planId: "plan-1",
      placeId: null,
    });
  });

  // Mutation: leave `placeId` out of the INSERT, and a draft drawn for a
  // place's route slot comes back after a kill with no place.
  it("keeps the place it is being drawn for", async () => {
    await saveRouteDraft({ ...base, planId: null, placeId: "place-1" });
    expect(await readRouteDraft()).toEqual({
      ...base,
      planId: null,
      placeId: "place-1",
    });
  });

  // Mutation: leave `planId` or `placeId` out of the ON CONFLICT update, and a
  // later save of the same draft keeps the one it had before.
  it("forgets the plan and the place once the draft is saved without them", async () => {
    await saveRouteDraft({ ...base, planId: "plan-1", placeId: "place-1" });
    await saveRouteDraft({ ...base, planId: null, placeId: null });
    expect(await readRouteDraft()).toMatchObject({
      planId: null,
      placeId: null,
    });
  });
});
