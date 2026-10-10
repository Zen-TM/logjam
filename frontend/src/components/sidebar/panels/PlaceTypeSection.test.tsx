import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScopedCustomFieldDef } from "@logjam/shared";

import type { TPlaceType } from "../../../placeUtils";
import PlaceTypeSection from "./PlaceTypeSection";

const CANYON: TPlaceType = {
  id: "type-canyon",
  ownerId: null,
  name: "Canyon",
  iconKey: "map-pin",
  color: "#F97316",
  position: 0,
  isSystem: true,
  placeCount: 3,
};
const HUT: TPlaceType = {
  ...CANYON,
  id: "type-hut",
  ownerId: "alice",
  name: "Hut",
  isSystem: false,
  placeCount: 0,
};
const CAVE: TPlaceType = { ...HUT, id: "type-cave", name: "Cave" };

const def = (
  key: string,
  label: string,
  scope: Partial<ScopedCustomFieldDef>,
): ScopedCustomFieldDef => ({
  key,
  label,
  type: "string",
  ownerId: "alice",
  appliesToAllTypes: false,
  placeTypeIds: [],
  tripTypes: [],
  ...scope,
});
const DEFS = [
  def("gate_code", "Gate code", { appliesToAllTypes: true }),
  def("bunks", "Bunks", { placeTypeIds: [HUT.id] }),
];

vi.mock("../../../placeUtils", () => ({
  createPlaceType: vi.fn(async () => CAVE),
  updatePlaceType: vi.fn(async () => HUT),
  deletePlaceType: vi.fn(),
  reassignPlaceType: vi.fn(),
  getPlaceTypes: vi.fn(async () => [CANYON, HUT, CAVE]),
  createCustomField: vi.fn(),
  updateCustomField: vi.fn(),
}));
vi.mock("../../dialogs/useCustomFieldImpact", () => ({
  useCustomFieldImpact: () => ({ count: null, error: null }),
}));

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

function renderSection() {
  return render(
    <PlaceTypeSection
      types={[CANYON, HUT]}
      loading={false}
      onTypesChange={() => {}}
      placeDefs={DEFS}
      onPlaceDefsChange={() => {}}
      onBack={() => {}}
    />,
  );
}

afterEach(cleanup);

/**
 * `stepAfterPlaceTypeSave`: a type just ADDED opens its attributes; a type
 * changed does not. Red when the create path closes the dialog and stops, or
 * when the step lists every attribute instead of the new type's.
 */
describe("a new place type leads into its attributes", () => {
  // By text and selector rather than by role: the type dialog holds a radio
  // per icon, and a role query computes every one's accessible name.
  const openDialog = () => document.querySelector("dialog[open]");

  it("opens the new type's attributes after Save, with only the ones a place of it shows", async () => {
    renderSection();
    fireEvent.click(screen.getAllByText("Add a place type")[0]);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Cave" },
    });
    fireEvent.click(screen.getByText("Save"));

    await screen.findByText("Cave attributes");
    const dialog = openDialog();
    expect(dialog?.textContent).toContain("Gate code");
    expect(dialog?.textContent).not.toContain("Bunks");

    // One press past it.
    fireEvent.click(screen.getByText("Done"));
    expect(openDialog()).toBeNull();
  });

  it("goes back to the list after a change to an existing type", async () => {
    renderSection();
    // The row lays a button over its card; its title is in a span too.
    fireEvent.click(screen.getAllByText("Hut")[0].closest("button")!);
    expect(openDialog()).not.toBeNull();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(openDialog()).toBeNull());
    expect(screen.queryByText(/attributes$/)).toBeNull();
  });
});
