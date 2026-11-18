import { describe, expect, it } from "vitest";

import { NSW_REGION } from "../regions.js";
import { SIM_NZ, SIM_UTAH } from "../simRegions.js";
import { leaderboardRules } from "./leaderboard.js";

describe("leaderboardRules", () => {
  // Mutation: close the season on `day`, not the day before it opens.
  it("tells an account in New South Wales what it always has, word for word", () => {
    expect(leaderboardRules(NSW_REGION).split("\n")).toEqual([
      "You're ranked by how many different canyons your trips this season went to. Doing one canyon twice counts once.",
      "Only places of the built-in Canyon type count, linked to a trip dated in the season.",
      "A season runs from 21 June to 20 June.",
      "Friends who've joined see your username and your count, never which canyons.",
      "Ties share a rank: two people level on most are both first.",
      "Finish in the top three and you'll see it here for a week after the season ends.",
      "Turn it off in Settings any time. You'll leave your friends' boards too.",
    ]);
  });

  // Mutation: hard-code June in the sentence.
  it("gives a region north of the equator its December season", () => {
    expect(leaderboardRules(SIM_UTAH)).toContain(
      "A season runs from 21 December to 20 December.",
    );
    expect(leaderboardRules(SIM_NZ)).toContain(
      "A season runs from 21 June to 20 June.",
    );
  });
});
