import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";
import { ICONS, TRIP_TYPE_ICON_KEYS } from "@logjam/shared";
import { WEB_ICONS } from "./webIcons";

// The web half of the icon registry guard (the phone's is
// mobile/src/ui/icons.test.ts; uniqueness is shared/src/icons.test.ts).
// lucide exports PascalCase components, so `circle-check` is `CircleCheck`.
const componentName = (key: string) =>
  key
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
const exports = lucide as unknown as Record<string, unknown>;

describe("ICONS on Logjam Web", () => {
  it("names a Lucide icon for every idea", () => {
    const missing = Object.entries(ICONS)
      .filter(([, { web }]) => !(componentName(web) in exports))
      .map(([idea, { web }]) => `${idea} → ${web}`);
    expect(missing, "no such Lucide export").toEqual([]);
  });

  it("maps exactly the registry's ideas", () => {
    expect(Object.keys(WEB_ICONS).sort()).toEqual(Object.keys(ICONS).sort());
  });

  // The map holds the components the bundle keeps; the registry holds the
  // names the phone's twin test and the docs read. They must be one fact.
  it("draws, for each idea, the component its registry name says", () => {
    for (const [idea, { web }] of Object.entries(ICONS)) {
      expect(
        WEB_ICONS[idea as keyof typeof ICONS],
        `${idea} should draw ${web}`,
      ).toBe(exports[componentName(web)]);
    }
  });

  it("has every trip type's glyph in Lucide", () => {
    const missing = TRIP_TYPE_ICON_KEYS.filter(
      (key) => !(componentName(key) in exports),
    );
    expect(missing).toEqual([]);
  });
});
