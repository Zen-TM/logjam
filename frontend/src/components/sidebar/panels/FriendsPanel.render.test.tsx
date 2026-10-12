import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRIENDS } from "@logjam/shared";

import { InviteLink } from "./FriendsPanel";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  getFriendInvites: vi.fn(async () => []),
  createFriendInvite: vi.fn(async () => ({
    token: "A".repeat(43),
    expiresAt: "2026-10-19T00:00:00.000Z",
  })),
}));

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
    expect(screen.getByText(/\/invite|A{43}/)).toBeTruthy();
  });
});
