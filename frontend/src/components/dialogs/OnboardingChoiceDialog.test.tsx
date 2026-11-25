import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NSW_REGION, ROPEWIKI_OFFER, type Region } from "@logjam/shared";
import OnboardingChoiceDialog from "./OnboardingChoiceDialog";

const importFromRopeWiki = vi.hoisted(() => vi.fn());
vi.mock("../../placeUtils", () => ({ importFromRopeWiki }));

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

const NZ: Region = { ...NSW_REGION, id: "nz", name: "New Zealand" };

const show = (canyonRegions: readonly Region[]) =>
  render(
    <OnboardingChoiceDialog
      open
      canyonRegions={canyonRegions}
      onImportFiles={() => {}}
      onStartEmpty={() => {}}
      onLoaded={() => {}}
    />,
  );

afterEach(() => {
  cleanup();
  importFromRopeWiki.mockReset();
});

describe("OnboardingChoiceDialog's RopeWiki rows", () => {
  // Mutation: build the title or hint from a literal "NSW" instead of the
  // region, or from the first region for every row.
  it("with only NSW shows today's exact copy", () => {
    show([NSW_REGION]);
    expect(
      screen.getByText("Load the NSW place database (RopeWiki)"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Recommended — hundreds of NSW canyons, so your trips have something to match against",
      ),
    ).toBeTruthy();
  });

  // Mutation: render a single row, or send no region (or the first region's id).
  it("offers one row per region and loads the one pressed", async () => {
    importFromRopeWiki.mockResolvedValue({
      imported: 3,
      skipped: 0,
      errors: [],
    });
    show([NSW_REGION, NZ]);
    expect(screen.getAllByText(/place database \(RopeWiki\)/)).toHaveLength(2);
    fireEvent.click(screen.getByText(ROPEWIKI_OFFER.title(NZ)));
    expect(importFromRopeWiki).toHaveBeenCalledExactlyOnceWith("nz");
    expect(await screen.findByText("3 places loaded")).toBeTruthy();
    // The other region's row is untouched and still offers its load.
    expect(screen.getByText(ROPEWIKI_OFFER.hint(NSW_REGION))).toBeTruthy();
  });

  // Mutation: share one loading flag across regions, or never disable the
  // footer while a load runs.
  it("locks Start empty while any region loads", () => {
    importFromRopeWiki.mockReturnValue(new Promise(() => {}));
    show([NSW_REGION, NZ]);
    fireEvent.click(screen.getByText(ROPEWIKI_OFFER.title(NZ)));
    const start = screen.getByRole("button", { name: "Start empty" });
    expect(start.getAttribute("aria-disabled")).toBe("true");
  });

  // Mutation: draw the row unconditionally.
  it("has no RopeWiki row without a canyon region", () => {
    show([]);
    expect(screen.queryByText(/RopeWiki/)).toBeNull();
    expect(screen.getByText("Import my own files")).toBeTruthy();
  });
});
