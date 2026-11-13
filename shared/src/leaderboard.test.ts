import { describe, it, expect } from "vitest";
import {
  computeLeaderboard,
  currentSeason,
  isPodiumWeek,
  medalFor,
  nudgeKind,
  previousSeason,
  selfStanding,
  type LeaderboardBoard,
} from "./leaderboard";
import { NSW_REGION } from "./regions";
import { SIM_NZ, SIM_UTAH } from "./simRegions";

const NSW = NSW_REGION;

// Sydney is UTC+10 in June (no DST), so 21 June 00:00 Sydney is 20 June 14:00 UTC.
const OPENING = new Date("2026-06-20T14:00:00.000Z");

describe("currentSeason", () => {
  it("opens on 21 June in Sydney, bounded by trip dates (UTC midnight)", () => {
    const season = currentSeason(OPENING, NSW);
    expect(season.label).toBe("2026–27");
    expect(season.start.toISOString()).toBe("2026-06-21T00:00:00.000Z");
    expect(season.end.toISOString()).toBe("2027-06-21T00:00:00.000Z");
  });

  it("is still last season one minute before 21 June in Sydney", () => {
    expect(currentSeason(new Date("2026-06-20T13:59:00.000Z"), NSW).label).toBe(
      "2025–26",
    );
  });

  it("reads March as the season that opened the June before", () => {
    expect(currentSeason(new Date("2027-03-01T00:00:00.000Z"), NSW).label).toBe(
      "2026–27",
    );
  });

  it("pads the second year across a century", () => {
    expect(currentSeason(new Date("2099-08-01T00:00:00.000Z"), NSW).label).toBe(
      "2099–00",
    );
  });
});

describe("a season in another region", () => {
  // Mutation: start every season on 21 June.
  it("opens on 21 December north of the equator, in its own day", () => {
    // 21 Dec 00:00 in Denver (UTC-7) is 07:00Z.
    expect(
      currentSeason(new Date("2026-12-21T06:59:00.000Z"), SIM_UTAH).label,
    ).toBe("2025–26");
    const opened = currentSeason(
      new Date("2026-12-21T07:00:00.000Z"),
      SIM_UTAH,
    );
    expect(opened.label).toBe("2026–27");
    expect(opened.start.toISOString()).toBe("2026-12-21T00:00:00.000Z");
    expect(opened.end.toISOString()).toBe("2027-12-21T00:00:00.000Z");
    // June, the middle of its canyoning summer, is still the season that opened the December before.
    expect(
      currentSeason(new Date("2027-06-21T00:00:00.000Z"), SIM_UTAH).label,
    ).toBe("2026–27");
  });

  // Mutation: read Sydney's clock for every region.
  it("turns over on the day in the region's own time zone", () => {
    // New Zealand is UTC+12 in June: 21 June 00:00 there is 20 June 12:00Z, two hours before Sydney's.
    expect(
      currentSeason(new Date("2026-06-20T11:59:00.000Z"), SIM_NZ).label,
    ).toBe("2025–26");
    expect(
      currentSeason(new Date("2026-06-20T12:00:00.000Z"), SIM_NZ).label,
    ).toBe("2026–27");
    expect(currentSeason(new Date("2026-06-20T12:00:00.000Z"), NSW).label).toBe(
      "2025–26",
    );
  });

  // Mutation: keep the podium week on 21 June.
  it("has its podium week after the December opening", () => {
    expect(isPodiumWeek(new Date("2026-12-22T00:00:00.000Z"), SIM_UTAH)).toBe(
      true,
    );
    expect(isPodiumWeek(new Date("2026-06-22T00:00:00.000Z"), SIM_UTAH)).toBe(
      false,
    );
    expect(
      previousSeason(new Date("2026-12-22T00:00:00.000Z"), SIM_UTAH).label,
    ).toBe("2025–26");
  });
});

describe("previousSeason", () => {
  it("ends where the current one starts", () => {
    const prev = previousSeason(OPENING, NSW);
    expect(prev.label).toBe("2025–26");
    expect(prev.end).toEqual(currentSeason(OPENING, NSW).start);
  });
});

describe("isPodiumWeek", () => {
  it("is the seven Sydney days from 21 June", () => {
    expect(isPodiumWeek(OPENING, NSW)).toBe(true);
    expect(isPodiumWeek(new Date("2026-06-27T13:59:00.000Z"), NSW)).toBe(true); // 27 Jun
    expect(isPodiumWeek(new Date("2026-06-27T14:00:00.000Z"), NSW)).toBe(false); // 28 Jun
    expect(isPodiumWeek(new Date("2026-06-20T13:59:00.000Z"), NSW)).toBe(false); // 20 Jun
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
  it("gives ranks 1–3 a medal, but not on a board of one or at 0 canyons", () => {
    expect(
      [1, 2, 3, 4].map((rank) => medalFor({ rank, canyonCount: 2 }, 5)),
    ).toEqual(["gold", "silver", "bronze", null]);
    expect(medalFor({ rank: 1, canyonCount: 2 }, 1)).toBeNull();
    expect(medalFor({ rank: 1, canyonCount: 0 }, 5)).toBeNull();
  });
});

const board = (
  entries: { rank: number; isSelf?: boolean }[],
  notJoined: string[] = [],
): LeaderboardBoard => ({
  joined: true,
  season: "2026–27",
  entries: entries.map((entry, index) => ({
    userId: `u${index}`,
    username: `u${index}`,
    canyonCount: 1,
    rank: entry.rank,
    isSelf: entry.isSelf ?? false,
  })),
  notJoined,
  podium: null,
});

describe("selfStanding", () => {
  it("is the user's own rank on a tied board, out of everyone on it", () => {
    expect(
      selfStanding(
        board([{ rank: 1 }, { rank: 1, isSelf: true }, { rank: 3 }]),
      ),
    ).toEqual({ rank: 1, size: 3 });
  });
});

describe("nudgeKind", () => {
  it("asks while anyone hasn't joined, says alone on a board of one, else nothing", () => {
    expect(nudgeKind(board([{ rank: 1, isSelf: true }], ["kit"]))).toBe("ask");
    expect(nudgeKind(board([{ rank: 1, isSelf: true }]))).toBe("alone");
    expect(nudgeKind(board([{ rank: 1, isSelf: true }, { rank: 2 }]))).toBe(
      null,
    );
  });
});
