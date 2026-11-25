import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACCOUNT, TRIP_PLAN_INVITE_TTL_DAYS, navLabel } from "@logjam/shared";
import { describe, expect, it } from "vitest";

// public/delete-account.html is what Play's Data safety form links to, and it
// names buttons and a number the clients draw from shared/. The steps it
// can't take from there ("More", "Delete my account") are not checked.
//
// Mutation that turns it red: change ACCOUNT.copy.deleteAccount, the Account
// nav label or TRIP_PLAN_INVITE_TTL_DAYS in shared/ without the page.
const html = readFileSync(
  join(import.meta.dirname, "..", "public", "delete-account.html"),
  "utf8",
);

describe("delete-account.html", () => {
  it.each([
    ["the invite-link life", `${TRIP_PLAN_INVITE_TTL_DAYS} days`],
    ["the Leaving section", ACCOUNT.copy.leaving],
    ["the Delete account button", ACCOUNT.copy.deleteAccount],
    ["the Account page", navLabel("account")],
  ])("names %s as the clients draw it", (_what, text) => {
    expect(html).toContain(text);
  });
});
