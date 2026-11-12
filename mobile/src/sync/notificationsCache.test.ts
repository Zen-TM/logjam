import { describe, expect, it, vi } from "vitest";

const getNotifications = vi.hoisted(() => vi.fn());
const db = vi.hoisted(() => ({
  runAsync: vi.fn(),
  getAllAsync: vi.fn(async () => []),
}));
vi.mock("../api/queries", () => ({ getNotifications }));
vi.mock("./syncDb", () => ({
  getSyncDb: async () => db,
  notifyMirrorChanged: vi.fn(),
}));

const { fetchAndCacheNotifications } = await import("./notificationsCache");

describe("fetchAndCacheNotifications", () => {
  // Mutation: clear the cache before the fetch rather than in the write after it.
  it("leaves the cached inbox alone when the fetch fails", async () => {
    getNotifications.mockRejectedValueOnce(new Error("offline"));
    await expect(fetchAndCacheNotifications()).rejects.toThrow("offline");
    expect(db.runAsync).not.toHaveBeenCalled();
  });
});
