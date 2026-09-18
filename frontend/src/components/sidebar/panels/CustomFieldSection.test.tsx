import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopedCustomFieldDef } from "@logjam/shared";

import CustomFieldSection from "./CustomFieldSection";

// The section only reaches the network through a rename/delete/create, none of
// which this suite performs — the dialogs are stubbed so nothing mounts MUI.
vi.mock("../../../placeUtils", () => ({
  updateCustomField: vi.fn(),
}));
vi.mock("../../dialogs/ConfirmDialog", () => ({ default: () => null }));
vi.mock("../../dialogs/DeleteCustomFieldDialog", () => ({ default: () => null }));
vi.mock("../../dialogs/AddCustomFieldDialog", () => ({ default: () => null }));
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
};

const OWN_DEF: ScopedCustomFieldDef = {
  key: "access_beta",
  label: "Access beta",
  type: "string",
  ownerId: "alice",
  appliesToAllTypes: true,
  placeTypeIds: [],
};

function renderSection(defs: ScopedCustomFieldDef[]) {
  return render(
    <CustomFieldSection
      entity="place"
      sectionLabel="Place attributes"
      tooltip="Extra things you record on a place."
      emptyText="None yet."
      loading={false}
      defs={defs}
      onDefsChange={() => {}}
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
  it("offers Rename and Delete only on the user's own definitions", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    expect(screen.getAllByRole("button", { name: "Rename" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);

    const own = screen.getByText("Access beta").closest("div")!.parentElement!;
    expect(within(own).getByRole("button", { name: "Rename" })).toBeTruthy();
  });

  it("says a built-in is built in, rather than leaving it looking editable", () => {
    renderSection([SYSTEM_DEF]);
    expect(screen.getAllByText(/Built-in/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("lists the user's own definitions before the built-ins", () => {
    renderSection([SYSTEM_DEF, OWN_DEF]);
    const labels = screen
      .getAllByText(/Quality|Access beta/)
      .map((node) => node.textContent);
    expect(labels[0]).toContain("Access beta");
  });
});
