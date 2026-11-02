// Logjam GPS draws exactly the sections `LEADERBOARD` names, and Friends draws
// its leaderboard button only for someone who has joined.
//
// Mutations that turn it red: add `{ key: "medals" }` to
// `LEADERBOARD.sections`; delete `nudge` from `LEADERBOARD_SECTIONS`; make
// `podium` draw without `podiumShown`; drop the `leaderboardOptIn &&` guard
// from Friends' `LeaderboardButton`; hide the Settings switch for a guest
// (`isGuest ? null :`), or let it turn on with a reason showing.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  contractSectionKeys,
  LEADERBOARD,
  type LeaderboardResponse,
} from "@logjam/shared";

import { LEADERBOARD_SECTIONS } from "./LeaderboardScreen";

// Only the module-level section map is wanted, so everything the screen
// draws or calls is stubbed out (vitest hoists these above the imports).
vi.mock("react-native", () => ({
  RefreshControl: "RefreshControl",
  ScrollView: "ScrollView",
  Share: {},
  Text: "Text",
  View: "View",
}));
vi.mock("../theme", () => ({
  makeStyles: () => () => ({}),
  muted: () => ({}),
  radius: {},
  spacing: (n: number) => n * 8,
  useHues: () => ({}),
  useTheme: () => ({}),
}));
vi.mock("../ui", () => ({}));
vi.mock("../api/friends", () => ({}));
vi.mock("../auth/AccountStateContext", () => ({}));
vi.mock("../auth/capabilities", () => ({}));
vi.mock("../map/connectivity", () => ({}));
vi.mock("../prefsDb", () => ({}));

const read = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

const board: Extract<LeaderboardResponse, { joined: true }> = {
  joined: true,
  season: "2026–27",
  entries: [
    { userId: "a", username: "ana", canyonCount: 4, rank: 1, isSelf: true },
  ],
  notJoined: [],
  podium: { season: "2025–26", rank: 1, canyonCount: 9 },
};
const props = {
  board,
  podiumShown: true,
  onBack: () => {},
  backLabel: "More",
  onDismissPodium: () => {},
  onOpenRules: () => {},
};

describe("Logjam GPS draws what the leaderboard contracts name", () => {
  it("the leaderboard's sections", () => {
    expect(Object.keys(LEADERBOARD_SECTIONS).sort()).toEqual(
      [...contractSectionKeys(LEADERBOARD, "gps")].sort(),
    );
  });

  it("the podium only while there is one and it is not dismissed", () => {
    expect(LEADERBOARD_SECTIONS.podium(props)).not.toBeNull();
    expect(
      LEADERBOARD_SECTIONS.podium({ ...props, podiumShown: false }),
    ).toBeNull();
    expect(
      LEADERBOARD_SECTIONS.podium({
        ...props,
        board: { ...board, podium: null },
      }),
    ).toBeNull();
  });

  it("Friends draws its leaderboard button only for someone who has joined", () => {
    expect(read("./FriendsScreen.tsx")).toMatch(
      /leaderboardOptIn && board\?\.joined !== false \? \(\s*<LeaderboardButton/,
    );
  });

  // `capabilityStatus("serverPrefs")` answers "Needs an account" for a guest
  // (auth/capabilities.test.ts); this holds the switch to it.
  it("the Settings switch shows for a guest, dead with the reason", () => {
    const source = read("./settings/PrivacySettingsScreen.tsx");
    expect(source).not.toMatch(/isGuest \?/);
    expect(source).toContain(
      'capabilityStatus("serverPrefs", accountState, online)',
    );
    expect(source).toContain(
      "subtitle={leaderboardBlocked ?? LEADERBOARD_SETTING.hint}",
    );
    expect(source).toMatch(/ready=\{\s*leaderboardBlocked === undefined &&/);
  });
});
