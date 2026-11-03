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
import { reassignPlaceType } from "../../../placeUtils";
import PlaceTypeSection from "./PlaceTypeSection";

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));

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

// jsdom has no Popover API (the row menu), nor layout (it measures its anchor).
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
});
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function renderSection(types = [CANYON, HUT]) {
  return render(
    <PlaceTypeSection
      types={types}
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

/**
 * Merge moves every place of a type and deletes the type, with no undo. Red
 * when the select opens on a type (the first other one) instead of "Choose a
 * type", or the Merge button works before a target is picked.
 */
describe("merging a place type", () => {
  it("moves nothing until the user picks where the places go, then says what moved", async () => {
    renderSection([CANYON, { ...HUT, placeCount: 2 }, CAVE]);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Hut" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Merge/ }));

    const dialog = document.querySelector("dialog[open]")!;
    const select = dialog.querySelector("select")!;
    const merge = screen.getByRole("button", { name: "Merge" });
    expect(select.value).toBe("");
    expect(merge.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(merge);
    expect(reassignPlaceType).not.toHaveBeenCalled();

    fireEvent.change(select, { target: { value: CAVE.id } });
    expect(dialog.textContent).toContain('Merge "Hut" into "Cave"?');
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() =>
      expect(reassignPlaceType).toHaveBeenCalledWith(HUT.id, CAVE.id),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("2 places moved to Cave"),
    );
  });
});
