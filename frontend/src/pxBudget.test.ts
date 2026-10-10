import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * frontend/AGENTS.md: a size or a space is a custom property, never a px
 * literal. The kit (`src/ui`) is converted; the screens are not yet, so each
 * stylesheet outside it has a BUDGET of the literals it still writes, and the
 * budget only goes down — the `KNOWN_FAILURES` pattern of
 * `scripts/wcag-contrast.mjs`. A stylesheet over its budget fails; one under
 * it fails too, until its line here is lowered (or deleted at 0), so a
 * conversion is banked and cannot quietly be spent again.
 *
 * Not counted (the rule's exemptions): a 1–2px border or offset, the 768px
 * breakpoint (a media query cannot read a custom property), a comment, and a
 * line marked `/* intrinsic … *\/` — a size that IS the thing (a 36×4 grab
 * handle), not a step on a scale.
 *
 * Mutation that turns it red: add `padding: 10px;` to any screen stylesheet.
 */
const SRC = dirname(fileURLToPath(import.meta.url));

const BUDGET: Record<string, number> = {
  "components/App.module.css": 5,
  "components/ConsentGate.module.css": 5,
  "components/Footer.module.css": 3,
  "components/SignIn.module.css": 12,
  "components/common/PlacePicker.module.css": 7,
  "components/dialogs/AddCustomFieldForm.module.css": 7,
  "components/dialogs/ChangeEmailDialog.module.css": 1,
  "components/dialogs/CustomFieldInput.module.css": 1,
  "components/dialogs/DeleteAccountDialog.module.css": 1,
  "components/dialogs/GeoPdfDialog.module.css": 11,
  "components/dialogs/ImportResultSummary.module.css": 6,
  "components/dialogs/MatchReview.module.css": 7,
  "components/dialogs/OnboardingChoiceDialog.module.css": 1,
  "components/dialogs/PlaceDialog.module.css": 6,
  "components/dialogs/RopeWikiReviewDialog.module.css": 9,
  "components/dialogs/RouteNameDialog.module.css": 1,
  "components/dialogs/SelectedPlacesDialog.module.css": 5,
  "components/dialogs/SendCopyDialog.module.css": 6,
  "components/dialogs/ShareDialog.module.css": 5,
  "components/dialogs/TopoDialog.module.css": 18,
  "components/dialogs/TripLogDialog.module.css": 14,
  "components/dialogs/UnifiedImportDialog.module.css": 16,
  "components/dialogs/topoSettings/topoSettings.module.css": 15,
  "components/feedback/RootErrorBoundary.module.css": 10,
  "components/feedback/ToastProvider.module.css": 4,
  "components/map/LayersPopover.module.css": 28,
  "components/map/Map.module.css": 27,
  "components/map/MapChrome.module.css": 32,
  "components/map/MapSearchBox.module.css": 15,
  "components/media/Lightbox.module.css": 1,
  "components/media/MediaGallery.module.css": 7,
  "components/media/PlaceSlideshow.module.css": 9,
  "components/routes/ElevationProfile.module.css": 6,
  "components/routes/RouteDrawPanel.module.css": 5,
  "components/sidebar/BottomSheet.module.css": 6,
  "components/sidebar/NavRail.module.css": 21,
  "components/sidebar/panels/AccountPanel.module.css": 3,
  "components/sidebar/panels/AnalyticsPanel.module.css": 9,
  "components/sidebar/panels/FriendSharingSection.module.css": 6,
  "components/sidebar/panels/FriendsPanel.module.css": 5,
  "components/sidebar/panels/ListPage.module.css": 5,
  "components/sidebar/panels/MapsPanel.module.css": 13,
  "components/sidebar/panels/NotificationsPanel.module.css": 7,
  "components/sidebar/panels/PlaceDetailPanel.module.css": 7,
  "components/sidebar/panels/PlaceFilterSheet.module.css": 2,
  "components/sidebar/panels/PlacesPanel.module.css": 9,
  "components/sidebar/panels/RoutesPanel.module.css": 6,
  "components/sidebar/panels/SettingsPanel.module.css": 2,
  "components/sidebar/panels/ThemeChooser.module.css": 5,
  "components/sidebar/panels/TripDetailPanel.module.css": 6,
  "components/sidebar/panels/TripLogsPanel.module.css": 14,
  "components/sidebar/panels/WayDetailPanel.module.css": 3,
};

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "ui" && dir === SRC ? [] : stylesheets(path);
    return entry.name.endsWith(".module.css") ? [path] : [];
  });
}

/** The px literals a stylesheet writes, outside the exemptions. */
function countPx(css: string): number {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, (comment) =>
      comment.includes("intrinsic") ? "\u0000" : "",
    )
    .split("\n")
    .filter((line) => !line.includes("\u0000") && !/^\s*@media/.test(line))
    .flatMap((line) => line.match(/(?<![\w.-])\d*\.?\d+px\b/g) ?? [])
    .filter((literal) => Number.parseFloat(literal) > 2).length;
}

describe("px literals outside the kit", () => {
  const counts = Object.fromEntries(
    stylesheets(SRC).map((path) => [
      relative(SRC, path),
      countPx(readFileSync(path, "utf8")),
    ]),
  );

  it("counts what the rule forbids and nothing it allows", () => {
    expect(countPx("a { padding: 10px 1px; border: 2px solid; }")).toBe(1);
    expect(countPx("@media (max-width: 768px) {\n  a { gap: 1.5px; }\n}")).toBe(
      0,
    );
    expect(countPx("a { height: 4px; /* intrinsic: the grab handle */ }")).toBe(
      0,
    );
    expect(countPx("/* was 12px */ a { gap: var(--space-1); }")).toBe(0);
  });

  it("never rises above a stylesheet's budget", () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (BUDGET[file] ?? 0))
      .map(
        ([file, n]) => `${file}: ${n} px literals, budget ${BUDGET[file] ?? 0}`,
      );
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
