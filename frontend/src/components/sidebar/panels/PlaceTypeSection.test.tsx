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
  it("opens the new type's attributes after Save, with only the ones a place of it shows", async () => {
    renderSection();
    fireEvent.click(screen.getAllByRole("button", { name: /type/i })[0]);
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Cave" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // A generous wait: the section re-reads its types through a lazy import
    // before the step opens, which a cold run takes over a second to resolve.
    await screen.findByRole(
      "heading",
      { name: "Cave attributes" },
      { timeout: 10_000 },
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Gate code");
    expect(dialog.textContent).not.toContain("Bunks");
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();

    // One press past it.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("goes back to the list after a change to an existing type", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /^Hut/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
      timeout: 10_000,
    });
    expect(screen.queryByRole("heading", { name: /attributes$/ })).toBeNull();
  });
});
