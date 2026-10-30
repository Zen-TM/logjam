import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEADERBOARD,
  LEADERBOARD_SETTING,
  leaderboardNudge,
  leaderboardPodiumLine,
  leaderboardSeasonLine,
  type LeaderboardResponse,
} from "@logjam/shared";

import LeaderboardPage from "./LeaderboardPage";

const copy = LEADERBOARD.copy;

// jsdom has no modal dialog: the rules open in one.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const entry = (
  username: string,
  canyonCount: number,
  rank: number,
  isSelf = false,
) => ({ userId: `${username}-id`, username, canyonCount, rank, isSelf });

function board(
  over: Partial<Extract<LeaderboardResponse, { joined: true }>> = {},
): LeaderboardResponse {
  return {
    joined: true,
    season: "2026–27",
    entries: [
      entry("alice", 5, 1, true),
      entry("bob", 5, 1),
      entry("carol", 2, 3),
      entry("dave", 1, 4),
    ],
    notJoined: [],
    podium: null,
    ...over,
  };
}

function show(
  response: LeaderboardResponse | null,
  error: string | null = null,
) {
  return render(
    <LeaderboardPage
      board={response}
      error={error}
      onRetry={() => {}}
      onBack={() => {}}
    />,
  );
}

describe("LeaderboardPage", () => {
  // Mutation: draw a medal for every rank, or let `medalFor` see a board of 2+
  // when there is one.
  it("gives ranks 1–3 a medal on a board of two or more, ties sharing it", () => {
    show(board());
    expect(screen.getAllByRole("img", { name: "gold medal" })).toHaveLength(2);
    expect(screen.queryByRole("img", { name: "silver medal" })).toBeNull();
    expect(screen.getAllByRole("img", { name: "bronze medal" })).toHaveLength(
      1,
    );
    expect(screen.getByRole("heading", { name: "#1 of 4" })).toBeTruthy();
    expect(screen.getByText(leaderboardSeasonLine("2026–27"))).toBeTruthy();
  });

  // Mutation: drop the 0-canyon condition, and 21 June is all gold.
  it("gives no medal at 0 canyons, even level at rank 1", () => {
    show(
      board({
        entries: [entry("alice", 0, 1, true), entry("bob", 0, 1)],
        podium: { season: "2025–26", rank: 1, canyonCount: 0 },
      }),
    );
    expect(screen.queryByRole("img", { name: /medal/ })).toBeNull();
  });

  it("gives a board of one no medal, and says it is just you", () => {
    show(board({ entries: [entry("alice", 3, 1, true)] }));
    expect(screen.queryByRole("img", { name: /medal/ })).toBeNull();
    expect(screen.getByText(copy.alone)).toBeTruthy();
  });

  // Mutation: mark every row, or none.
  it("marks the user's own row, and only theirs", () => {
    show(board());
    const marks = screen.getAllByText(copy.you);
    expect(marks).toHaveLength(1);
    expect(marks[0].closest("[data-selected]")?.textContent).toContain("alice");
  });

  it("names who has not joined", () => {
    show(board({ notJoined: ["erin", "frank"] }));
    expect(screen.getByText(leaderboardNudge(["erin", "frank"]))).toBeTruthy();
    expect(screen.queryByText(copy.alone)).toBeNull();
  });

  // Mutation: draw the rules on the page again, where a long board buries them.
  it("keeps the rules behind the hero's button", () => {
    show(board());
    expect(screen.queryByRole("listitem")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.rulesTitle }));
    expect(screen.getByRole("dialog", { name: copy.rulesTitle })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(
      copy.rules.split("\n").length,
    );
  });

  // Mutation: forget the stored season, or key it by anything but the
  // podium's season.
  it("shows the podium until it is dismissed, on this device", () => {
    const podium = { season: "2025–26", rank: 2, canyonCount: 7 };
    show(board({ podium }));
    const line = leaderboardPodiumLine(podium);
    expect(screen.getByText(line)).toBeTruthy();
    expect(screen.getAllByRole("img", { name: "silver medal" })).toHaveLength(
      1,
    );

    fireEvent.click(screen.getByRole("button", { name: copy.podiumDismiss }));
    expect(screen.queryByText(line)).toBeNull();

    cleanup();
    show(board({ podium }));
    expect(screen.queryByText(line)).toBeNull();

    cleanup();
    const next = { season: "2026–27", rank: 1, canyonCount: 9 };
    show(board({ podium: next }));
    expect(screen.getByText(leaderboardPodiumLine(next))).toBeTruthy();
  });

  it("draws the contract's sections in its order", () => {
    show(
      board({
        podium: { season: "2025–26", rank: 1, canyonCount: 4 },
        notJoined: ["erin"],
      }),
    );
    const inOrder = [
      screen.getByRole("heading", { level: 2 }),
      screen.getByText(/You came first/),
      screen.getByText("dave"),
      screen.getByText(leaderboardNudge(["erin"])),
    ];
    for (let i = 1; i < inOrder.length; i += 1) {
      expect(
        inOrder[i - 1].compareDocumentPosition(inOrder[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  // Mutation: treat `{ joined: false }` as still loading, and the page spins
  // for good after the user leaves on another device.
  it("says the user has left when the server says they have", () => {
    show({ joined: false });
    expect(screen.getByText(LEADERBOARD_SETTING.left)).toBeTruthy();
    expect(screen.queryByText(copy.loading)).toBeNull();
  });

  it("says it is loading, then that it failed", () => {
    show(null);
    expect(screen.getByText(copy.loading)).toBeTruthy();
    cleanup();
    show(null, copy.loadFailed);
    expect(screen.getByText(copy.loadFailed)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
