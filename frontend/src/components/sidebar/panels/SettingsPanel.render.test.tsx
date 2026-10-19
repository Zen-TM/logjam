import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEADERBOARD_SETTING } from "@logjam/shared";

import { updateUserPreferences, type TUser } from "../../../placeUtils";
import SettingsPanel from "./SettingsPanel";

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
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

function show(onCurrentUserChange = vi.fn()) {
  render(
    <SettingsPanel
      currentUser={user}
      customFieldDefs={[]}
      onCustomFieldDefsChange={() => {}}
      placeCustomFieldDefs={[]}
      onPlaceCustomFieldDefsChange={() => {}}
      placeTypes={[]}
      onPlaceTypesChange={() => {}}
      onCurrentUserChange={onCurrentUserChange}
    />,
  );
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
      expect(toast.success).toHaveBeenCalledWith(LEADERBOARD_SETTING.joined),
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
