import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopedCustomFieldDef } from "@logjam/shared";

import CustomFieldSection from "./CustomFieldSection";

// The section only reaches the network through a rename/delete/create, none of
// which this suite performs — the dialogs are stubbed so nothing mounts MUI.
vi.mock("../../../placeUtils", () => ({
  createCustomField: vi.fn(),
  updateCustomField: vi.fn(),
}));
vi.mock("../../dialogs/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../../dialogs/DeleteCustomFieldDialog", () => ({ default: () => null }));
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

function renderSection(defs: ScopedCustomFieldDef[]) {
  return render(
    <CustomFieldSection
      entity="place"
      title="Place attributes"
      rowNoun="place"
      loading={false}
      defs={defs}
      onDefsChange={() => {}}
      onBack={() => {}}
    />,
  );
}

// vitest runs without globals, so nothing unmounts the previous render for us.
afterEach(cleanup);

/**
 * The server looks a definition up under the CALLER's id, so a built-in is a
 * 404 to both `PATCH` and `DELETE` — "Custom field not found" is what Rename on
 * "Quality" used to produce. A button that fails is worse than one that is
 * absent, so the guard is that the built-in row carries no verbs at all.
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
    expect(screen.getAllByRole("button", { name: /^Actions for/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Actions for Access beta" })).toBeTruthy();
  });

  it("files a built-in under Built in, rather than leaving it looking editable", () => {
    renderSection([SYSTEM_DEF]);
    expect(screen.getByRole("heading", { name: /Built in/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });

  it("lists the user's own definitions before the built-ins", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    const headings = screen.getAllByRole("heading").map((node) => node.textContent ?? "");
    expect(headings.findIndex((text) => text.includes("Yours"))).toBeLessThan(
      headings.findIndex((text) => text.includes("Built in")),
    );
  });
});
