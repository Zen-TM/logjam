import { describe, expect, it } from "vitest";

import { bulkReadAction, selectionCountLabel } from "./bulkReadAction";

const read = (id: string) => ({ id, read: true });
const unread = (id: string) => ({ id, read: false });

describe("bulkReadAction — one button, both directions", () => {
  it("offers nothing for an empty selection", () => {
    expect(bulkReadAction([])).toBeNull();
  });

  it("marks a wholly-read selection UNREAD, every row of it", () => {
    const action = bulkReadAction([read("a"), read("b")]);
    expect(action).toMatchObject({ read: false, icon: "eye-off", label: "Mark as unread" });
    expect(action?.ids).toEqual(["a", "b"]);
  });

  it("marks a wholly-unread selection read", () => {
    const action = bulkReadAction([unread("a"), unread("b")]);
    expect(action).toMatchObject({ read: true, icon: "eye", label: "Mark as read" });
    expect(action?.ids).toEqual(["a", "b"]);
  });

  it("touches ONLY the unread rows of a mixed selection", () => {
    // The mixed case is the one the operator asked about: it behaves as
    // all-unread does, so the read rows are left exactly as they are rather
    // than being re-marked (which would be a no-op op per row in the outbox).
    const action = bulkReadAction([read("a"), unread("b"), read("c"), unread("d")]);
    expect(action?.read).toBe(true);
    expect(action?.ids).toEqual(["b", "d"]);
    expect(action?.label).toBe("Mark the unread ones as read");
  });
});

describe("selectionCountLabel", () => {
  it("names the unread tally, which is what decides the button's direction", () => {
    expect(selectionCountLabel([read("a"), unread("b")])).toBe("2 selected · 1 unread");
    expect(selectionCountLabel([read("a")])).toBe("1 selected");
    expect(selectionCountLabel([unread("a")])).toBe("1 selected · 1 unread");
  });
});
