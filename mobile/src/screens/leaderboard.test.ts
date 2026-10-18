import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../prefsDb", () => ({
  readPref: () => stored.value,
  writePref: (_key: string, value: string) => {
    stored.value = value;
    return true;
  },
}));

const { dismissPodium, isPodiumDismissed, nudgeKind, selfStanding } =
  await import("./leaderboard");

const row = (username: string, rank: number, isSelf = false) => ({
  userId: username,
  username,
  canyonCount: 10 - rank,
  rank,
  isSelf,
});

const boardOf = (
  entries: ReturnType<typeof row>[],
  notJoined: string[] = [],
) => ({
  joined: true as const,
  season: "2026–27",
  entries,
  notJoined,
  podium: null,
});

describe("nudgeKind", () => {
  // Mutations: show "alone" whenever notJoined is empty; drop the "ask" branch.
  it("asks while anyone hasn't joined, says alone only on a board of one", () => {
    expect(nudgeKind(boardOf([row("me", 1, true)], ["kit"]))).toBe("ask");
    expect(
      nudgeKind(boardOf([row("me", 1, true), row("bo", 2)], ["kit"])),
    ).toBe("ask");
    expect(nudgeKind(boardOf([row("me", 1, true)]))).toBe("alone");
    expect(nudgeKind(boardOf([row("me", 1, true), row("bo", 2)]))).toBeNull();
  });
});

describe("selfStanding", () => {
  // Mutation: take the first entry's rank, or count only the friends.
  it("is the user's own rank, on a board counting everyone", () => {
    const board = boardOf([row("ana", 1), row("bo", 1), row("me", 3, true)]);
    expect(selfStanding(board)).toEqual({ rank: 3, size: 3 });
  });
});

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
