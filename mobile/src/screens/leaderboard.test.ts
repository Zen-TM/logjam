import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../prefsDb", () => ({
  readPref: () => stored.value,
  writePref: (_key: string, value: string) => {
    stored.value = value;
    return true;
  },
}));

const { dismissPodium, isPodiumDismissed } = await import("./leaderboard");

describe("the podium's dismissal", () => {
  // Mutation: read any stored value as dismissed (`!== null`).
  it("holds for the season dismissed, and not for the next", () => {
    stored.value = null;
    expect(isPodiumDismissed("2025–26")).toBe(false);
    expect(dismissPodium("2025–26")).toBe(true);
    expect(isPodiumDismissed("2025–26")).toBe(true);
    expect(isPodiumDismissed("2026–27")).toBe(false);
  });
});
