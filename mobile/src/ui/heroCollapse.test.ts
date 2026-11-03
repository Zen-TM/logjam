import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The four long lists pin a hero that gives way to the compact row once the
// list scrolls. Mutation: drop `compact={heroCollapse.compact}` or the
// `scrollProps` spread from one screen, and that list pins its full hero again.
describe("list screens collapse their hero", () => {
  it.each([
    "../places/PlacesScreen.tsx",
    "../logs/LogsScreen.tsx",
    "../screens/FriendsScreen.tsx",
    "../plans/PlansScreen.tsx",
  ])("%s", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("compact={heroCollapse.compact}");
    expect(source).toContain("{...heroCollapse.scrollProps}");
    expect(source).toContain("{...heroCollapse.heroProps}");
  });
});
