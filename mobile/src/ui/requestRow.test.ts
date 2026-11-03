import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A question put to the user (a friend request, a file offered, someone asking
// to join a plan) is answered in its row by one component, so the three lists
// that carry one cannot draw it three ways.
//
// Mutation that turns it red: in `plans/PeopleView.tsx`, change the asking
// rows' `<RequestRow` back to `<Row`.
const SRC = join(__dirname, "..");

describe("answering a request in its row", () => {
  it.each([
    "screens/NotificationsScreen.tsx",
    "screens/FriendsScreen.tsx",
    "plans/PeopleView.tsx",
  ])("%s draws its requests with RequestRow", (file) => {
    expect(readFileSync(join(SRC, file), "utf8")).toContain("<RequestRow");
  });
});
