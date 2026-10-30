import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRIENDS } from "@logjam/shared";

import { getLeaderboard, sendFriendRequest } from "../../../placeUtils";
import FriendsPanel, { AddFriendDialog, InviteLink } from "./FriendsPanel";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  getFriendInvites: vi.fn(async () => []),
  searchUsers: vi.fn(async () => ({
    data: [{ id: "carol-id", username: "carol" }],
    total: 1,
  })),
  sendFriendRequest: vi.fn(),
  getLeaderboard: vi.fn(async () => ({
    joined: true,
    season: "2026–27",
    entries: [
      { userId: "a", username: "alice", canyonCount: 4, rank: 2, isSelf: true },
      { userId: "b", username: "bob", canyonCount: 6, rank: 1, isSelf: false },
    ],
    notJoined: [],
    podium: null,
  })),
  createFriendInvite: vi.fn(async () => ({
    token: "A".repeat(43),
    expiresAt: "2026-10-19T00:00:00.000Z",
  })),
}));

// jsdom has no modal dialogs, ResizeObserver or scrollIntoView. Assigned, not
// stubbed: `unstubAllGlobals` runs after every test.
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
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
});

describe("the invite link in the Add dialog", () => {
  // The link was made and is on screen; only the copy failed. Mutation: let a
  // refused clipboard fall into the catch that reports the mint.
  it("does not say the link could not be made when only the clipboard refused", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        writeText: () => Promise.reject(new DOMException("denied")),
      },
    });
    render(<InviteLink open />);

    fireEvent.click(
      screen.getByRole("button", { name: FRIENDS.copy.inviteCopy }),
    );

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(FRIENDS.copy.inviteCopyFailed);
    expect(screen.getByText(/A{43}/)).toBeTruthy();
  });

  // Mutation: show the link whenever one is made.
  it("keeps the link off the page when it reached the clipboard", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: () => Promise.resolve() },
    });
    render(<InviteLink open />);

    fireEvent.click(
      screen.getByRole("button", { name: FRIENDS.copy.inviteCopy }),
    );

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(FRIENDS.copy.inviteCopied),
    );
    expect(screen.queryByText(/A{43}/)).toBeNull();
  });
});

// POST /friends/request answers with the friendship row, accepted when the
// other person had already asked. Mutation: mark every sent row "Requested".
describe("sending a request from the Add dialog", () => {
  async function send(row: { status: string }) {
    vi.mocked(sendFriendRequest).mockResolvedValue(row);
    const onFriended = vi.fn();
    render(
      <AddFriendDialog
        open
        friends={[]}
        onClose={() => {}}
        onSent={() => {}}
        onFriended={onFriended}
      />,
    );
    fireEvent.change(screen.getByLabelText(FRIENDS.copy.searchField), {
      target: { value: "carol" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: FRIENDS.copy.add }),
    );
    return onFriended;
  }

  it("shows a friend when they had already asked", async () => {
    const onFriended = await send({ status: "accepted" });

    expect(await screen.findByText(FRIENDS.copy.pillFriend)).toBeTruthy();
    expect(screen.queryByText(FRIENDS.copy.pillRequested)).toBeNull();
    expect(toast.success).toHaveBeenCalledWith("carol is now a friend.");
    // Their request's prompt has gone from the inbox.
    expect(onFriended).toHaveBeenCalled();
  });

  it("shows a request when they had not", async () => {
    const onFriended = await send({ status: "pending" });

    expect(await screen.findByText(FRIENDS.copy.pillRequested)).toBeTruthy();
    expect(onFriended).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

// Off, the feature is invisible: nothing on Friends mentions it, and it asks
// the server nothing. Mutation: draw the button whatever the switch says.
describe("the leaderboard button on Friends", () => {
  function show(leaderboardOptIn: boolean) {
    render(
      <FriendsPanel
        leaderboardOptIn={leaderboardOptIn}
        friends={[]}
        friendRequests={[]}
        onRefetchFriends={() => {}}
        onRefetchShared={() => {}}
        onRefetchNotifications={() => {}}
      />,
    );
  }

  it("is absent for someone who has not joined", () => {
    show(false);
    expect(screen.queryByRole("button", { name: /Leaderboard/ })).toBeNull();
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  // Mutation: trust the cached preference over the server's `false`.
  it("goes when the server says the user left on another device", async () => {
    vi.mocked(getLeaderboard).mockResolvedValueOnce({ joined: false });
    show(true);
    await waitFor(() => expect(getLeaderboard).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Leaderboard/ })).toBeNull(),
    );
  });

  // Mutation: drop the rank from the button's name, and the badge says it to
  // no one using a screen reader.
  it("wears a joined user's rank and opens the board in place", async () => {
    show(true);
    const button = await screen.findByRole("button", {
      name: "Leaderboard, you're #2 of 2",
    });
    expect(button.textContent).toBe("2");

    fireEvent.click(button);
    expect(
      await screen.findByRole("heading", { name: "#2 of 2" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: FRIENDS.title })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to friends" }));
    expect(screen.getByRole("heading", { name: FRIENDS.title })).toBeTruthy();
  });
});
