import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * shared/DESIGN.md §14: "the kit does looks, a screen does layout". A screen
 * stylesheet that paints a corner, a shadow or a fill is drawing a look the kit
 * should own, and a second copy of it drifts. The kit (`src/ui`) is the only
 * place those three are declared freely; each stylesheet outside it has a
 * BUDGET of the `border-radius`, `box-shadow` and `background` declarations it
 * still writes, and the budget only goes down — the `pxBudget.test.ts` pattern.
 * A stylesheet over its budget fails; one under it fails too, until its line
 * here is lowered (or deleted at 0), so a conversion is banked.
 *
 * Mutation that turns it red: add `border-radius: 4px;` to any screen
 * stylesheet.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

const BUDGET: Record<string, number> = {
  "components/App.module.css": 3,
  "components/ConsentGate.module.css": 4,
  "components/SignIn.module.css": 7,
  "components/common/PlacePicker.module.css": 5,
  "components/dialogs/AddCustomFieldForm.module.css": 1,
  "components/dialogs/GeoPdfDialog.module.css": 3,
  "components/dialogs/ImportResultSummary.module.css": 2,
  "components/dialogs/MatchReview.module.css": 4,
  "components/dialogs/RopeWikiReviewDialog.module.css": 6,
  "components/dialogs/SendCopyDialog.module.css": 1,
  "components/dialogs/ShareDialog.module.css": 2,
  "components/dialogs/TopoDialog.module.css": 5,
  "components/dialogs/TripLogDialog.module.css": 2,
  "components/dialogs/UnifiedImportDialog.module.css": 6,
  "components/dialogs/topoSettings/topoSettings.module.css": 7,
  "components/feedback/RootErrorBoundary.module.css": 4,
  "components/map/LayersPopover.module.css": 12,
  "components/map/Map.module.css": 14,
  "components/map/MapChrome.module.css": 4,
  "components/map/MapSearchBox.module.css": 10,
  "components/media/Lightbox.module.css": 5,
  "components/media/MediaGallery.module.css": 13,
  "components/media/MediaUpload.module.css": 4,
  "components/media/PlaceSlideshow.module.css": 11,
  "components/routes/ElevationProfile.module.css": 3,
  "components/sidebar/BottomSheet.module.css": 5,
  "components/sidebar/NavRail.module.css": 11,
  "components/sidebar/SidebarPanel.module.css": 1,
  "components/sidebar/panels/ListPage.module.css": 2,
  "components/sidebar/panels/NotificationsPanel.module.css": 1,
  "components/sidebar/panels/PlaceDetailPanel.module.css": 1,
  "components/sidebar/panels/PlacesPanel.module.css": 1,
  "components/sidebar/panels/ThemeChooser.module.css": 4,
  "components/sidebar/panels/TripLogsPanel.module.css": 2,
};

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "ui" && dir === SRC ? [] : stylesheets(path);
    return entry.name.endsWith(".module.css") ? [path] : [];
  });
}

/** The look declarations a stylesheet writes: corner, shadow, fill. */
function countLooks(css: string): number {
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .match(
        /^\s*(?:border-radius|box-shadow|background(?:-color|-image)?)\s*:/gm,
      ) ?? []
  ).length;
}

describe("looks outside the kit", () => {
  const counts = Object.fromEntries(
    stylesheets(SRC).map((path) => [
      relative(SRC, path),
      countLooks(readFileSync(path, "utf8")),
    ]),
  );

  it("counts corners, shadows and fills, and not their mention in a comment", () => {
    const css = [
      "a {",
      "  border-radius: 4px;",
      "  box-shadow: none;",
      "  background: red;",
      "  background-color: x;",
      "}",
      "/* background: x; */",
      "b { border: 1px solid; }",
    ].join("\n");
    expect(countLooks(css)).toBe(4);
  });

  it("never rises above a stylesheet's budget", () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (BUDGET[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} looks, budget ${BUDGET[file] ?? 0}`);
    expect(over).toEqual([]);
  });

  it("is lowered when a stylesheet converts (the budget only shrinks)", () => {
    const under = Object.entries(BUDGET)
      .filter(([file, budget]) => (counts[file] ?? 0) < budget)
      .map(
        ([file, budget]) =>
          `${file}: now ${counts[file] ?? 0}, lower its budget from ${budget}`,
      );
    expect(under).toEqual([]);
  });
});
