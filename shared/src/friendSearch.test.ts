import { describe, expect, it } from "vitest";

import { avatarHueIndex, avatarInitials, friendMatches } from "./friendSearch";

describe("friendMatches", () => {
  it("matches everything on an empty or blank query", () => {
    expect(friendMatches("bmarshall", "")).toBe(true);
    expect(friendMatches("bmarshall", "   ")).toBe(true);
  });

  it("matches anywhere in the name, ignoring case and surrounding space", () => {
    expect(friendMatches("bmarshall", "MARSH")).toBe(true);
    expect(friendMatches("bmarshall", "  shall ")).toBe(true);
    expect(friendMatches("bmarshall", "zz")).toBe(false);
  });
});

describe("avatarInitials", () => {
  it("takes the first letter of each part when there are parts", () => {
    expect(avatarInitials("jo_smith")).toBe("JS");
    expect(avatarInitials("mary-anne-p")).toBe("MA");
  });

  it("takes the first two letters of a single word", () => {
    expect(avatarInitials("bmarshall")).toBe("BM");
  });

  it("never returns an empty mark", () => {
    expect(avatarInitials("")).toBe("?");
    expect(avatarInitials("___")).toBe("?");
    expect(avatarInitials("x")).toBe("X");
  });
});

describe("avatarHueIndex", () => {
  it("is stable for a name and inside the palette", () => {
    const first = avatarHueIndex("bmarshall", 5);
    expect(avatarHueIndex("bmarshall", 5)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(5);
  });

  it("does not depend on position — two names keep their own slots", () => {
    // The property that matters: a new friend arriving cannot repaint anyone
    // else, because nothing here reads a list.
    expect(avatarHueIndex("ctan", 5)).toBe(avatarHueIndex("ctan", 5));
    expect(avatarHueIndex("dkerr", 7)).toBeLessThan(7);
  });
});
