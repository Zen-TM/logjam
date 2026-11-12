// Who is on a friends leaderboard. Joining shares a count of trip data, so a
// friend is on the board only once they have opted in; the rest are named
// only in the nudge, by username.
//
// Mutations that turn it red: default `leaderboardOptIn` to true in
// `normalizeUserUiPreferences`; drop the opt-in check in
// `collectLeaderboardParticipants`.
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

import { collectLeaderboardParticipants } from "./friends";

const self = { id: "me", username: "alice" };
const party = (id: string, prefs: unknown = {}) => ({
  id,
  username: id,
  uiPreferences: prefs,
});
const sentTo = (other: ReturnType<typeof party>) => ({
  requesterId: self.id,
  requester: party(self.id),
  addressee: other,
});
const receivedFrom = (other: ReturnType<typeof party>) => ({
  requesterId: other.id,
  requester: other,
  addressee: party(self.id),
});

describe("collectLeaderboardParticipants", () => {
  it("puts friends who joined on the board, from either side of the friendship", () => {
    const { participants, notJoined } = collectLeaderboardParticipants(self, [
      sentTo(party("bob", { leaderboardOptIn: true })),
      receivedFrom(party("carol", { leaderboardOptIn: true })),
    ]);
    expect([...participants.keys()].sort()).toEqual(["bob", "carol", "me"]);
    expect(notJoined).toEqual([]);
  });

  it("keeps a friend who never chose off the board", () => {
    const { participants, notJoined } = collectLeaderboardParticipants(self, [
      sentTo(party("zed")),
      receivedFrom(party("dan", { leaderboardOptIn: false })),
      sentTo(party("bob", { leaderboardOptIn: "yes" })),
    ]);
    expect([...participants.keys()]).toEqual(["me"]);
    expect(notJoined).toEqual(["bob", "dan", "zed"]);
  });

  it("carries usernames only, never an email", () => {
    const withEmail = {
      ...party("bob", { leaderboardOptIn: true }),
      email: "bob@example.com",
    };
    const result = collectLeaderboardParticipants(self, [sentTo(withEmail)]);
    expect(JSON.stringify([...result.participants])).not.toContain(
      "example.com",
    );
  });
});
