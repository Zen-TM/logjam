import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The screens are too heavy to render here, so this holds the call sites.
// Mutation: put `<Text>{notes}</Text>` back in one of these screens, and a
// note shows its Markdown as typed on that screen only.
describe("the screens that read a note", () => {
  it.each([
    "places/PlaceDetailScreen.tsx",
    "logs/TripDetailScreen.tsx",
    "plans/PlanPlaceSheet.tsx",
  ])("%s draws it with NoteBody", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    expect(source).toMatch(/<NoteBody notes=\{/);
    expect(source).not.toMatch(/<Text[^>]*>\s*\{(place|current|trip)\.notes\}/);
  });
});
