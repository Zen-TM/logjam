import { describe, it, expect } from "vitest";
import {
  computeLeaderboard,
  currentSeason,
  isPodiumWeek,
  medalFor,
  previousSeason,
} from "./leaderboard";

// Sydney is UTC+10 in June (no DST), so 21 June 00:00 Sydney is 20 June 14:00 UTC.
const OPENING = new Date("2026-06-20T14:00:00.000Z");

describe("currentSeason", () => {
  it("opens on 21 June in Sydney, bounded by trip dates (UTC midnight)", () => {
    const season = currentSeason(OPENING);
    expect(season.label).toBe("2026–27");
    expect(season.start.toISOString()).toBe("2026-06-21T00:00:00.000Z");
    expect(season.end.toISOString()).toBe("2027-06-21T00:00:00.000Z");
  });

  it("is still last season one minute before 21 June in Sydney", () => {
    expect(currentSeason(new Date("2026-06-20T13:59:00.000Z")).label).toBe(
      "2025–26",
    );
  });

  it("reads March as the season that opened the June before", () => {
    expect(currentSeason(new Date("2027-03-01T00:00:00.000Z")).label).toBe(
      "2026–27",
    );
  });

  it("pads the second year across a century", () => {
    expect(currentSeason(new Date("2099-08-01T00:00:00.000Z")).label).toBe(
      "2099–00",
    );
  });
});

describe("previousSeason", () => {
  it("ends where the current one starts", () => {
    const prev = previousSeason(OPENING);
    expect(prev.label).toBe("2025–26");
    expect(prev.end).toEqual(currentSeason(OPENING).start);
  });
});

describe("isPodiumWeek", () => {
  it("is the seven Sydney days from 21 June", () => {
    expect(isPodiumWeek(OPENING)).toBe(true);
    expect(isPodiumWeek(new Date("2026-06-27T13:59:00.000Z"))).toBe(true); // 27 Jun
    expect(isPodiumWeek(new Date("2026-06-27T14:00:00.000Z"))).toBe(false); // 28 Jun
    expect(isPodiumWeek(new Date("2026-06-20T13:59:00.000Z"))).toBe(false); // 20 Jun
  });
});

describe("computeLeaderboard", () => {
  it("counts distinct canyons", () => {
    const [entry] = computeLeaderboard([
      { userId: "u1", username: "alice", placeIds: ["c1", "c1", "c2"] },
    ]);
    expect(entry.canyonCount).toBe(2);
  });

  it("ranks most first; ties share a rank, list by username, and use up the next (1, 1, 3)", () => {
    const board = computeLeaderboard([
      { userId: "u3", username: "carol", placeIds: ["c5"] },
      { userId: "u2", username: "bob", placeIds: ["c3", "c4"] },
      { userId: "u1", username: "alice", placeIds: ["c1", "c2"] },
    ]);
    expect(board.map((e) => [e.username, e.rank])).toEqual([
      ["alice", 1],
      ["bob", 1],
      ["carol", 3],
    ]);
  });

  it("handles nobody and a board of one", () => {
    expect(computeLeaderboard([])).toEqual([]);
    expect(
      computeLeaderboard([{ userId: "u1", username: "alice", placeIds: [] }]),
    ).toEqual([{ userId: "u1", username: "alice", canyonCount: 0, rank: 1 }]);
  });
});

describe("medalFor", () => {
  it("gives ranks 1–3 a medal, but not on a board of one", () => {
    expect([1, 2, 3, 4].map((rank) => medalFor(rank, 5))).toEqual([
      "gold",
      "silver",
      "bronze",
      null,
    ]);
    expect(medalFor(1, 1)).toBeNull();
  });
});
