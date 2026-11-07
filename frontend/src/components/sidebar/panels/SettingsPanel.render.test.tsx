import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contractSectionKeys,
  COPY_MEDIA_SETTING,
  LEADERBOARD_SETTING,
  NOTIFICATION_PREFERENCES,
  notificationGroupLead,
  NSW_REGION,
  REGION_CHOICE,
  regionChoiceProblem,
  SETTINGS,
  type Region,
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
    regions = undefined as readonly Region[] | undefined,
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
      regions={regions}
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

// Mutation: send `leaderboardOptIn` instead of `copyPlaceMedia`, or seed the
// switch off when the account has no stored choice (the server reads it as on).
describe("the copy-photos switch", () => {
  it("starts on, sits under Copying a place before Friends, and saves the account's choice", async () => {
    const saved = { ...user, uiPreferences: { copyPlaceMedia: false } };
    vi.mocked(updateUserPreferences).mockResolvedValue(saved);
    const onCurrentUserChange = vi.fn();
    renderPanel(onCurrentUserChange);
    const toggle = screen.getByRole("switch", {
      name: COPY_MEDIA_SETTING.label,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    const group = screen.getByRole("group", { name: SETTINGS.copy.copying });
    expect(within(group).getByRole("switch")).toBe(toggle);
    const friends = screen.getByRole("group", { name: SETTINGS.copy.friends });
    expect(
      group.compareDocumentPosition(friends) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(onCurrentUserChange).toHaveBeenCalledWith(saved),
    );
    expect(updateUserPreferences).toHaveBeenCalledWith({
      copyPlaceMedia: false,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  // Mutation: leave the optimistic value standing after a failed save.
  it("goes back and says so when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error("offline"));
    renderPanel();
    const toggle = screen.getByRole("switch", {
      name: COPY_MEDIA_SETTING.label,
    });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(COPY_MEDIA_SETTING.saveFailed),
    );
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});

// Each notification switch sits in its group, whose lead starts the sentence
// its short label ends. Mutation: draw the switches in one group, or put one in
// the other group.
describe("the notification switches", () => {
  it("sit in their group", () => {
    show();
    for (const group of ["email", "inApp"] as const) {
      const box = screen.getByRole("group", {
        name: notificationGroupLead(group, "Logjam Web"),
      });
      const expected = NOTIFICATION_PREFERENCES.filter(
        (row) => row.group === group,
      ).map((row) => row.label);
      expect(within(box).getAllByRole("switch")).toHaveLength(expected.length);
      for (const name of expected) {
        within(box).getByRole("switch", { name });
      }
    }
  });
});

// Logjam GPS's Settings menu lists its pages in `SETTINGS`' order; Logjam Web
// draws the sections both have in that same order, under the same names.
// Mutation: hard-code a section title that differs from `SETTINGS.copy`, or
// draw a group lead with `SectionHeader` so an extra h3 lands between the three.
// (The order itself is the contract's: reordering `SETTINGS.sections` turns the
// shared contract test red and this one with it.)
describe("the sections", () => {
  it("are the contract's, in its order, under its names", () => {
    renderPanel();
    const shown = screen
      .getAllByRole("heading", { level: 3 })
      .map((el) => el.textContent);
    const expected = contractSectionKeys(SETTINGS, "web")
      .filter((key) => ["display", "notifications", "privacy"].includes(key))
      .map((key) => SETTINGS.copy[key as keyof typeof SETTINGS.copy]);
    expect(shown.slice(0, expected.length)).toEqual(expected);
    expect(expected).toEqual([
      "Display",
      "Notifications",
      "Privacy and security",
    ]);
  });

  it("leave out the pages only the phone has", () => {
    renderPanel();
    for (const name of ["Map", "Offline and storage"]) {
      expect(screen.queryByRole("heading", { name })).toBeNull();
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

const TWO_REGIONS: Region[] = [
  NSW_REGION,
  {
    ...NSW_REGION,
    id: "nz",
    name: "New Zealand",
    basemaps: [],
    defaultBasemap: "osm-topo",
  },
];

describe("the Regions section", () => {
  // Mutation: draw the section whatever `offersRegionChoice` says, or leave it
  // out of `sections`, and one of these two goes red.
  it("is drawn with a second region, one switch each, from the account's choice", () => {
    renderPanel(vi.fn(), { regions: TWO_REGIONS });
    expect(screen.getByText(SETTINGS.copy.regions)).toBeTruthy();
    expect(screen.getByText(REGION_CHOICE.hint)).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "NSW" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "New Zealand" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("is not drawn with one region", () => {
    renderPanel(vi.fn(), { regions: [NSW_REGION] });
    expect(screen.queryByText(SETTINGS.copy.regions)).toBeNull();
    expect(screen.queryByRole("switch", { name: "NSW" })).toBeNull();
  });

  // Mutation: let the last chosen region switch off, or send the other
  // region's id, and this goes red.
  it("saves the new choice, and refuses to turn off the last region", async () => {
    const saved = { ...user, uiPreferences: { regions: ["nsw", "nz"] } };
    vi.mocked(updateUserPreferences).mockResolvedValue(saved);
    renderPanel(vi.fn(), { regions: TWO_REGIONS });
    const nsw = screen.getByRole("switch", { name: "NSW" });
    expect((nsw as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(regionChoiceProblem([])!)).toBeTruthy();
    fireEvent.click(nsw);
    expect(updateUserPreferences).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("switch", { name: "New Zealand" }));
    await waitFor(() =>
      expect(updateUserPreferences).toHaveBeenCalledWith({
        regions: ["nsw", "nz"],
      }),
    );
  });

  // Mutation: leave the optimistic value standing after a failed save.
  it("goes back and says so when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(updateUserPreferences).mockRejectedValue(new Error("offline"));
    renderPanel(vi.fn(), { regions: TWO_REGIONS });
    const nz = screen.getByRole("switch", { name: "New Zealand" });
    fireEvent.click(nz);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(REGION_CHOICE.saveFailed),
    );
    expect(nz.getAttribute("aria-checked")).toBe("false");
  });
});
