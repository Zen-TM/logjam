import { describe, expect, it } from "vitest";
import { labelWithBadge, NAV, navBadgeNoun, navFor, navLabel } from "./nav.js";

const ids = (entries: readonly { id: string }[]) =>
  entries.map((entry) => entry.id);
const group = (platform: "web" | "gps", which: "page" | "personal") =>
  ids(navFor(platform).filter((entry) => entry.group === which));
const more = (platform: "web" | "gps") =>
  ids(navFor(platform).filter((entry) => !entry.tab));

// The order a user meets on each client, written out. Mutation: swap two web
// items in `NAV`, and this turns red on every client that draws it.
describe("NAV", () => {
  it("runs Logjam Web's rail pages, then Inbox, Settings, Account", () => {
    expect(group("web", "page")).toEqual([
      "places",
      "logs",
      "ways",
      "plans",
      "friends",
    ]);
    expect(group("web", "personal")).toEqual(["inbox", "settings", "account"]);
  });

  it("runs Logjam Web's narrow tabs and More", () => {
    expect(ids(navFor("web").filter((entry) => entry.tab))).toEqual([
      "places",
      "logs",
      "ways",
    ]);
    expect(more("web")).toEqual([
      "inbox",
      "plans",
      "friends",
      "settings",
      "account",
    ]);
  });

  it("runs Logjam GPS's tabs and More", () => {
    expect(ids(navFor("gps").filter((entry) => entry.tab))).toEqual([
      "places",
      "logs",
      "saved",
    ]);
    expect(more("gps")).toEqual([
      "inbox",
      "plans",
      "friends",
      "syncIssues",
      "settings",
      "account",
    ]);
  });

  it("gives each one-client entry its reason", () => {
    for (const entry of NAV as readonly { on?: string; reason?: string }[])
      expect(Boolean(entry.on), JSON.stringify(entry)).toBe(
        Boolean(entry.reason),
      );
  });

  it("names the trips tab Trips", () => {
    expect(navLabel("logs")).toBe("Trips");
  });
});

// Mutation: return the bare label for a positive count, or drop `badgeNoun`
// from `plans` (Logjam Web and Logjam GPS would then say different things).
describe("labelWithBadge", () => {
  it("names the count so a hidden badge is still heard", () => {
    expect(labelWithBadge("Inbox", 3)).toBe("Inbox, 3 unread");
    expect(labelWithBadge("Inbox", 0)).toBe("Inbox");
    expect(labelWithBadge("Plans", 1, "invited")).toBe("Plans, 1 invited");
  });

  it("reads a destination's noun from NAV on both clients", () => {
    expect(navBadgeNoun("plans")).toBe("invited");
    expect(navBadgeNoun("inbox")).toBeUndefined();
  });
});
