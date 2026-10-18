// Logjam GPS draws exactly the sections `LEADERBOARD` names, and Friends draws
// the `leaderboard` section `FRIENDS` gained, only for someone who has joined.
//
// Mutations that turn it red: add `{ key: "medals" }` to
// `LEADERBOARD.sections`; delete `rules` from `LEADERBOARD_SECTIONS`; make
// `podium` draw without `podiumShown`; drop the `leaderboardOptIn &&` guard
// from Friends' `leaderboard` section; let the Settings switch show for a guest.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  contractSectionKeys,
  FRIENDS,
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
  onDismissPodium: () => {},
  onAsk: () => {},
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

  it("Friends draws its leaderboard row only for someone who has joined", () => {
    expect(contractSectionKeys(FRIENDS, "gps")).toContain("leaderboard");
    expect(read("./FriendsScreen.tsx")).toMatch(
      /leaderboard: \(\) =>[\s\S]{0,120}leaderboardOptIn && board\?\.joined !== false \?/,
    );
  });

  it("the Settings switch is absent for a guest", () => {
    expect(read("./settings/PrivacySettingsScreen.tsx")).toMatch(
      /\{isGuest \? null : \([\s\S]{0,200}LEADERBOARD_SETTING\.label/,
    );
  });
});
