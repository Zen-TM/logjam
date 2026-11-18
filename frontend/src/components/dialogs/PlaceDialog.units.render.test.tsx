import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLACE_FORM,
  setDisplayUnits,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import PlaceDialog from "./PlaceDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { deleteMedia } from "../../placeUtils";
import type { TPlace, TPlaceType } from "../../placeUtils";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ media: [] })),
  deleteMedia: vi.fn(async () => {}),
}));
// The real one needs a file chooser: this one "uploads" (m1) on a press.
vi.mock("../media/MediaUpload", () => ({
  default: ({ onUploaded }: { onUploaded: (item: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onUploaded({ id: "m1", mediaType: "image/jpeg" })}
    >
      Fake upload
    </button>
  ),
}));

// jsdom has no matchMedia, ResizeObserver, scrollIntoView or modal <dialog>.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

afterEach(() => {
  cleanup();
  setDisplayUnits("metric");
});

const CANYON = {
  id: SYSTEM_PLACE_TYPE_IDS.canyon,
  name: "Canyon",
  iconKey: "mountain",
  color: "#336699",
} as TPlaceType;

const DEFS = SYSTEM_FIELD_DEFS.map((def) => ({
  ...def,
  ownerId: null,
  appliesToAllTypes: false,
  placeTypeIds: def.placeTypes.map((key) => SYSTEM_PLACE_TYPE_IDS[key]),
  tripTypes: [],
})) as unknown as ScopedCustomFieldDef[];

// A made-up gorge in the Blue Mountains, its longest pitch 15 m.
const GORGE = {
  id: "p1",
  name: "Made-up gorge",
  altNames: [],
  latitude: -33.74,
  longitude: 150.31,
  placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
  fieldValues: { longest_abseil: 15 },
} as unknown as TPlace;

const onClose = vi.fn();
const dialog = (open: boolean) => (
  <ToastProvider>
    <PlaceDialog
      place={GORGE}
      open={open}
      onClose={onClose}
      onSaved={() => {}}
      onPickCoords={() => {}}
      onCancelPickCoords={() => {}}
      customFieldDefs={DEFS}
      onCustomFieldDefsChange={() => {}}
      placeTypes={[CANYON]}
      initialCoords={null}
    />
  </ToastProvider>
);

const longest = (name: string) =>
  screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("PlaceDialog, a length when the units change", () => {
  // The rule: the length text and its conversion are always in one unit, so a
  // change of units re-seeds the text from the stored metres (what was typed is
  // dropped), wherever the dialog was when it changed, a map pick included.
  // Mutation: drop the `else if (open && seededUnits !== units)` branch of
  // PlaceDialog, and a pick's reopen (which only ends the pick) leaves the text
  // "15" in feet.
  it("re-seeds its text when the units change while it is closed for a pick on the map", () => {
    const { rerender } = render(dialog(true));
    expect(longest("Longest pitch (0+)").value).toBe("15");
    fireEvent.click(
      screen.getByRole("button", { name: PLACE_FORM.copy.selectOnMap }),
    );
    rerender(dialog(false));
    setDisplayUnits("imperial");
    rerender(dialog(false));
    rerender(dialog(true));
    expect(longest("Longest pitch (0+ ft)").value).toBe("49.2");
  });

  // Mutation: drop the same branch, and the text stays "15" in feet under a
  // dialog that is open.
  it("re-seeds its text when the units change under it", () => {
    const { rerender } = render(dialog(true));
    expect(longest("Longest pitch (0+)").value).toBe("15");
    setDisplayUnits("imperial");
    rerender(dialog(true));
    expect(longest("Longest pitch (0+ ft)").value).toBe("49.2");
  });

  // Mutation: `populateForm();` on every reopen after a pick, and the typed
  // text is lost when nothing changed.
  it("keeps what was typed when the units did not change over a pick", () => {
    const { rerender } = render(dialog(true));
    fireEvent.change(longest("Longest pitch (0+)"), {
      target: { value: "20" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: PLACE_FORM.copy.selectOnMap }),
    );
    rerender(dialog(false));
    rerender(dialog(true));
    expect(longest("Longest pitch (0+)").value).toBe("20");
  });

  // A flip re-seeds the fields and nothing else: this session's uploads stay on
  // the dialog's books, so Cancel still asks and takes them back.
  // Mutation: let the units path run all of `populateForm` (no `unitsOnly`), and
  // `uploadedIds` empties: Cancel closes without asking and `deleteMedia` is
  // never called.
  it("keeps this session's uploads when the units change under it", async () => {
    onClose.mockClear();
    vi.mocked(deleteMedia).mockClear();
    const { rerender } = render(dialog(true));
    fireEvent.click(screen.getAllByText("Fake upload")[0]);
    setDisplayUnits("imperial");
    rerender(dialog(true));
    expect(longest("Longest pitch (0+ ft)").value).toBe("49.2");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteMedia).toHaveBeenCalledWith("m1");
  });
});
