import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FRIENDS, INBOX, TRIP_PLANS_LIST } from "@logjam/shared";
import { backLabelOf } from "./backLabel";

const r = (key: string, name: string, params?: object) => ({
  key,
  name,
  params,
});

// Mutations that turn it red: read routes[i] instead of routes[i - 1];
// return a constant for Plans; drop a route from LABELS (falls to "Back").
describe("backLabelOf", () => {
  it("names the screen below, so one screen reached two ways says two things", () => {
    const fromMore = { routes: [r("a", "MoreHome"), r("b", "Plans")] };
    const fromInbox = {
      routes: [r("a", "MoreHome"), r("c", "Inbox"), r("b", "Plans")],
    };
    expect(backLabelOf(fromMore, "b")).toBe("More");
    expect(backLabelOf(fromInbox, "b")).toBe(INBOX.title);
  });

  it("takes a plan's or friend's own name from its params", () => {
    const s = {
      routes: [
        r("a", "Plans"),
        r("b", "Plan", { name: "Kanangra" }),
        r("c", "Plan", { name: "Other" }),
      ],
    };
    expect(backLabelOf(s, "c")).toBe("Kanangra");
    expect(backLabelOf(s, "b")).toBe(TRIP_PLANS_LIST.title);
    expect(
      backLabelOf({ routes: [r("a", "Friends"), r("b", "Account")] }, "b"),
    ).toBe(FRIENDS.title);
  });
});

// Mutation: put `{eyebrow}` back in the back row, and "← PLANS" reads as a
// back label again.
describe("Hero back row", () => {
  it("shows the destination's name beside the arrow, and types require it", () => {
    const hero = readFileSync(new URL("./Hero.tsx", import.meta.url), "utf8");
    const row = hero.slice(
      hero.indexOf("styles.backRow"),
      hero.indexOf(") : null}"),
    );
    expect(row).toContain("{backLabel}");
    expect(row).not.toContain("{eyebrow}");
    expect(hero).toMatch(/onBack: \(\) => void;[\s\S]*backLabel: string;/);
  });
});
