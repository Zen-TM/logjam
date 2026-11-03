import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

import PlaceDialog from "./PlaceDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { deleteMedia } from "../../placeUtils";
import type { TPlace, TPlaceType } from "../../placeUtils";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ media: [] })),
  deleteMedia: vi.fn(async () => {}),
}));
// The real one needs a file chooser; this one "uploads" on a press.
vi.mock("../media/MediaUpload", () => ({
  default: ({ onUploaded }: { onUploaded: (item: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onUploaded({
          id: "m1",
          mediaType: "application/gpx+xml",
          filename: "a.gpx",
        })
      }
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

afterEach(cleanup);

const CANYON = {
  id: SYSTEM_PLACE_TYPE_IDS.canyon,
  name: "Canyon",
  iconKey: "mountain",
  color: "#336699",
} as TPlaceType;

// Synthetic, like the e2e fixtures.
function place(id: string, name: string): TPlace {
  return {
    id,
    name,
    altNames: [],
    latitude: -33.74,
    longitude: 150.31,
    placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
    fieldValues: {},
  } as unknown as TPlace;
}

function dialog(p: TPlace | null) {
  return (
    <ToastProvider>
      <PlaceDialog
        place={p}
        open
        onClose={() => {}}
        onSaved={() => {}}
        onPickCoords={() => {}}
        onCancelPickCoords={() => {}}
        customFieldDefs={[]}
        onCustomFieldDefsChange={() => {}}
        placeTypes={[CANYON]}
      />
    </ToastProvider>
  );
}

const nameBox = () =>
  screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;

// The form fills from the place when the dialog opens or is handed a DIFFERENT
// place. A refetch hands over a new object for the same place, which must not
// replace what the user has typed. Mutation: compare `place` instead of
// `place?.id` in the populate step of PlaceDialog.
describe("PlaceDialog, while open", () => {
  it("keeps unsaved edits when the same place arrives as a new object", () => {
    const { rerender } = render(dialog(place("p1", "Alpha Gorge")));
    fireEvent.change(nameBox(), { target: { value: "My edit" } });

    rerender(dialog(place("p1", "Alpha Gorge")));

    expect(nameBox().value).toBe("My edit");
  });

  it("starts over when a different place is opened", () => {
    const { rerender } = render(dialog(place("p1", "Alpha Gorge")));
    fireEvent.change(nameBox(), { target: { value: "My edit" } });

    rerender(dialog(place("p2", "Bravo Chasm")));

    expect(nameBox().value).toBe("Bravo Chasm");
  });
});

// Uploads land on the server the moment they finish, so Discard has to take
// them back out. Mutation: drop `uploadedIds` from `isDirty`, or the delete
// loop from `handleRequestClose`.
describe("PlaceDialog, editing, after an upload", () => {
  it("asks before closing, and deletes the upload on Discard", async () => {
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <PlaceDialog
          place={place("p1", "Alpha Gorge")}
          open
          onClose={onClose}
          onSaved={() => {}}
          onPickCoords={() => {}}
          onCancelPickCoords={() => {}}
          customFieldDefs={[]}
          onCustomFieldDefsChange={() => {}}
          placeTypes={[CANYON]}
        />
      </ToastProvider>,
    );
    fireEvent.click(screen.getAllByText("Fake upload")[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteMedia).toHaveBeenCalledWith("m1");
  });
});
