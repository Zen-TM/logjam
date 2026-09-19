import { describe, expect, it } from "vitest";
import type { TNotification } from "@logjam/shared";
import { settleReadOverrides, withReadOverrides } from "./notificationReadOverrides";

const row = (id: string, read: boolean): TNotification => ({
  id,
  type: "topo_complete",
  payload: {},
  read,
  createdAt: "2026-09-14T00:00:00.000Z",
});

describe("withReadOverrides", () => {
  it("shows the read state the user just chose, and leaves the rest alone", () => {
    const list = [row("a", false), row("b", true)];
    const shown = withReadOverrides(list, new Map([["a", true]]));
    expect(shown.map((n) => n.read)).toEqual([true, true]);
    expect(shown[1]).toBe(list[1]);
    expect(withReadOverrides(list, new Map())).toBe(list);
  });
});

describe("settleReadOverrides", () => {
  it("keeps an override until a fetch agrees with it", () => {
    const overrides = new Map([["a", true]]);
    // A fetch that left before the write landed still says unread.
    expect(settleReadOverrides(overrides, [row("a", false)])).toBe(overrides);
    expect(settleReadOverrides(overrides, [row("a", true)]).size).toBe(0);
  });

  it("drops an override whose row the fetch no longer returns", () => {
    expect(settleReadOverrides(new Map([["gone", true]]), [row("a", false)]).size).toBe(0);
  });
});
