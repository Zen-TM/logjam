import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Pins the three sites that carry a question to one component, so they cannot
// quietly go back to their own look: the Inbox draws the pair with
// `RequestAnswers`, Friends and People draw their requests with `RequestRow`,
// and People's old icon-only accept is gone. It does not catch a fourth list
// that draws a request some other way; that one is a review's to find.
//
// Mutation that turns it red: in `plans/PeopleView.tsx`, change the asking
// rows' `<RequestRow` back to a `<Row` with `icon="accept"`.
const SRC = join(__dirname, "..");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

describe("answering a request in its row", () => {
  it("draws the Inbox's pair with RequestAnswers", () => {
    expect(read("screens/NotificationsScreen.tsx")).toContain(
      "<RequestAnswers",
    );
  });

  it.each(["screens/FriendsScreen.tsx", "plans/PeopleView.tsx"])(
    "%s draws its requests with RequestRow",
    (file) => {
      expect(read(file)).toContain("<RequestRow");
    },
  );

  it("keeps no icon-only Accept in People", () => {
    expect(read("plans/PeopleView.tsx")).not.toContain('icon="accept"');
  });
});
