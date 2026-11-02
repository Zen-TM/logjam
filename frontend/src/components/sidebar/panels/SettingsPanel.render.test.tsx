import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEADERBOARD_SETTING,
  NOTIFICATION_PREFERENCES,
  notificationGroupLead,
} from "@logjam/shared";

import { updateUserPreferences, type TUser } from "../../../placeUtils";
import SettingsPanel from "./SettingsPanel";

const toast = { done: vi.fn(), error: vi.fn() };
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("./ThemeChooser", () => ({ default: () => null }));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  updateUserPreferences: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const user = {
  id: "alice-id",
  uiPreferences: { leaderboardOptIn: false },
} as TUser;

function renderPanel(
  onCurrentUserChange = vi.fn(),
  {
    currentUser = user as TUser | null,
    currentUserError = null as string | null,
    onRetryCurrentUser = () => {},
  } = {},
) {
  render(
    <SettingsPanel
      currentUser={currentUser}
      currentUserError={currentUserError}
      onRetryCurrentUser={onRetryCurrentUser}
      customFieldDefs={[]}
      onCustomFieldDefsChange={() => {}}
      placeCustomFieldDefs={[]}
      onPlaceCustomFieldDefsChange={() => {}}
      placeTypes={[]}
      onPlaceTypesChange={() => {}}
      onCurrentUserChange={onCurrentUserChange}
    />,
  );
}

function show(onCurrentUserChange = vi.fn()) {
  renderPanel(onCurrentUserChange);
  return screen.getByRole("switch", { name: LEADERBOARD_SETTING.label });
}

describe("the leaderboard switch", () => {
  // Mutation: drop `onCurrentUserChange`, and Friends keeps the old answer
  // until a reload.
  it("joins, and hands the saved user to the rest of Logjam Web", async () => {
    const saved = { ...user, uiPreferences: { leaderboardOptIn: true } };
    vi.mocked(updateUserPreferences).mockResolvedValue(saved);
    const onCurrentUserChange = vi.fn();
    const toggle = show(onCurrentUserChange);
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(toast.done).toHaveBeenCalledWith(LEADERBOARD_SETTING.joined),
    );
    expect(updateUserPreferences).toHaveBeenCalledWith({
      leaderboardOptIn: true,
    });
    expect(onCurrentUserChange).toHaveBeenCalledWith(saved);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  // Mutation: leave the optimistic value standing after a failed save.
  it("goes back and says so when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error("offline"));
    const onCurrentUserChange = vi.fn();
    const toggle = show(onCurrentUserChange);

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(LEADERBOARD_SETTING.saveFailed),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(onCurrentUserChange).not.toHaveBeenCalled();
  });
});

// Each notification switch sits under its group's heading, which starts the
// sentence its short label ends. Mutation: draw the switches under one
// heading, or put one under the other group's.
describe("the notification switches", () => {
  it("sit under their group's heading", () => {
    show();
    const email = screen.getByRole("heading", {
      name: notificationGroupLead("email", "Logjam Web"),
    });
    const inApp = screen.getByRole("heading", {
      name: notificationGroupLead("inApp", "Logjam Web"),
    });
    const after = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (const { group, label } of NOTIFICATION_PREFERENCES) {
      const row = screen.getByRole("switch", { name: label });
      if (group === "email") {
        expect(after(email, row) && after(row, inApp)).toBe(true);
      } else {
        expect(after(inApp, row)).toBe(true);
      }
    }
  });
});

describe("an account that did not load", () => {
  // Mutation: drop the `!currentUser &&` guard, and a failed refetch under a
  // loaded account replaces the switches with an error.
  it("says so with Try again, and only when there is no account to show", () => {
    const retry = vi.fn();
    renderPanel(vi.fn(), {
      currentUser: null,
      currentUserError: "Couldn't load your account.",
      onRetryCurrentUser: retry,
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load your account.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("switch")).toBeNull();
    cleanup();
    renderPanel(vi.fn(), {
      currentUserError: "Couldn't load your account.",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
