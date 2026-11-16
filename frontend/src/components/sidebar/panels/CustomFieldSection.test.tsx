import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attributesHint,
  SETTINGS_LIST,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import CustomFieldSection, { TypeAttributesDialog } from "./CustomFieldSection";
import type { TPlaceType } from "../../../placeUtils";

// The simulated regions are declared when shared loads, so the flag is set
// before any import runs. Utah is the simulated region that grades in ACA.
vi.hoisted(() => {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
});

// The section only reaches the network through a rename/delete/create, none of
// which this suite performs — the dialogs are stubbed so nothing mounts MUI.
vi.mock("../../../placeUtils", () => ({
  createCustomField: vi.fn(),
  updateCustomField: vi.fn(),
}));
vi.mock("../../dialogs/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../../dialogs/DeleteCustomFieldDialog", () => ({
  default: () => null,
}));
vi.mock("../../dialogs/AddCustomFieldForm", () => ({ default: () => null }));
vi.mock("../../dialogs/useCustomFieldImpact", () => ({
  useCustomFieldImpact: () => ({ count: null, error: null }),
}));

/** A built-in: owned by no account, and its key is one of the reserved ones. */
const SYSTEM_DEF: ScopedCustomFieldDef = {
  key: "quality",
  label: "Quality",
  type: "float",
  min: 1,
  max: 5,
  ownerId: null,
  appliesToAllTypes: false,
  placeTypeIds: [],
  tripTypes: [],
};

const OWN_DEF: ScopedCustomFieldDef = {
  key: "access_beta",
  label: "Access beta",
  type: "string",
  ownerId: "alice",
  appliesToAllTypes: true,
  placeTypeIds: [],
  tripTypes: [],
};

function renderSection(defs: ScopedCustomFieldDef[], uiPreferences?: unknown) {
  return render(
    <CustomFieldSection
      entity="place"
      title="Place attributes"
      rowNoun="place"
      loading={false}
      defs={defs}
      onDefsChange={() => {}}
      uiPreferences={uiPreferences}
      onBack={() => {}}
    />,
  );
}

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

// vitest runs without globals, so nothing unmounts the previous render for us.
afterEach(cleanup);

/**
 * The server looks a definition up under the caller's ID, so a built-in is a
 * 404 to both `PATCH` and `DELETE`. A button that fails is worse than one that
 * is absent, so the guard is that the built-in row carries no verbs at all.
 */
describe("a built-in attribute gets no verbs", () => {
  it("opens the user's own definitions to rename, and never a built-in", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    // A `Row` with `onOpen` lays a button named for its title over the card.
    expect(screen.getByRole("button", { name: /^Access beta/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Quality/ })).toBeNull();
  });

  it("offers the actions menu only on the user's own definitions", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    expect(
      screen.getAllByRole("button", { name: /^Actions for/ }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Actions for Access beta" }),
    ).toBeTruthy();
  });

  it("files a built-in under Built in, rather than leaving it looking editable", () => {
    renderSection([SYSTEM_DEF]);
    expect(screen.getByRole("heading", { name: /Built in/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });

  it("lists the user's own definitions before the built-ins", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    const headings = screen
      .getAllByRole("heading")
      .map((node) => node.textContent ?? "");
    expect(headings.findIndex((text) => text.includes("Yours"))).toBeLessThan(
      headings.findIndex((text) => text.includes("Built in")),
    );
  });
});

// Mutation: show the hint only while the list is empty, or drop the line
// under "Built in", and a user with their own attributes (or a locked row they
// can't open) is left to guess what the page is for.
describe("what the page says about itself", () => {
  it("carries its help line and says why built-ins are locked", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    expect(screen.getByText(attributesHint("place"))).toBeTruthy();
    expect(
      screen.getByText(SETTINGS_LIST.copy.builtInAttributesWhy),
    ).toBeTruthy();
  });
});

// The built-in system definitions as the server sends them for Canyon.
const CANYON: TPlaceType = {
  id: SYSTEM_PLACE_TYPE_IDS.canyon,
  name: "Canyon",
  iconKey: "mountain",
  color: "#336699",
} as TPlaceType;
const BUILT_IN = SYSTEM_FIELD_DEFS.map((def) => ({
  ...def,
  ownerId: null,
  appliesToAllTypes: false,
  placeTypeIds: def.placeTypes.map((key) => SYSTEM_PLACE_TYPE_IDS[key]),
  tripTypes: [],
})) as unknown as ScopedCustomFieldDef[];
const ACCOUNT_IN_NSW = { regions: ["nsw"] };
const ACCOUNT_IN_UTAH = { regions: ["simutah"] };
const FRENCH = ["V grade", "A grade", "Commitment"];
const ACA = ["ACA technical", "ACA water", "ACA time", "ACA risk"];

// The grade attributes a built-in list names are those of the account's home
// region: Utah's ACA four are not shown over NSW. Guards the helper
// `listedAttributeDefs` at each list; its own rule is in canyonGrade.test.ts.
describe("the built-in grade attributes of the Place attributes list", () => {
  // Mutation: derive `own` and `system` from `defs` instead of `listed` in
  // `CustomFieldSection`.
  it("are the French three over NSW, and no ACA one", () => {
    const { container } = renderSection(BUILT_IN, ACCOUNT_IN_NSW);
    const text = container.textContent ?? "";
    for (const label of FRENCH) expect(text.includes(label)).toBe(true);
    for (const label of ACA) expect(text.includes(label)).toBe(false);
  });

  // Mutation: filter with the French system whatever the account, in
  // `listedAttributeDefs` (`canyonGrade.ts`).
  it("are the ACA four for an account whose home region grades in ACA", () => {
    const { container } = renderSection(BUILT_IN, ACCOUNT_IN_UTAH);
    const text = container.textContent ?? "";
    for (const label of ACA) expect(text.includes(label)).toBe(true);
    for (const label of FRENCH) expect(text.includes(label)).toBe(false);
  });
});

describe("the built-in grade attributes of a type's attributes dialog", () => {
  const dialogText = (uiPreferences: unknown) => {
    render(
      <TypeAttributesDialog
        type={CANYON}
        placeTypes={[CANYON]}
        defs={BUILT_IN}
        onDefsChange={() => {}}
        uiPreferences={uiPreferences}
        onClose={() => {}}
      />,
    );
    return document.querySelector("dialog")?.textContent ?? "";
  };

  // Mutation: drop `listedAttributeDefs` from the `shown` list of
  // `TypeAttributesDialog`.
  it("are the French three over NSW, and no ACA one", () => {
    const text = dialogText(ACCOUNT_IN_NSW);
    for (const label of FRENCH) expect(text.includes(label)).toBe(true);
    for (const label of ACA) expect(text.includes(label)).toBe(false);
  });

  // Mutation: filter with the French system whatever the account, in
  // `listedAttributeDefs` (`canyonGrade.ts`).
  it("are the ACA four for an account whose home region grades in ACA", () => {
    const text = dialogText(ACCOUNT_IN_UTAH);
    for (const label of ACA) expect(text.includes(label)).toBe(true);
    for (const label of FRENCH) expect(text.includes(label)).toBe(false);
  });
});
