import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PLACE_FORM, SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

import PlaceDialog from "./PlaceDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import type { TPlace, TPlaceType } from "../../placeUtils";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ media: [] })),
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

const box = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

// Mutation: put NumberField's sanitising back
// on the coordinate fields, and the pair is joined into -33.62901503156.
describe("PlaceDialog, a coordinate pair pasted into Latitude", () => {
  it("fills Latitude and Longitude", () => {
    render(dialog(null));
    fireEvent.change(box(/^Latitude/), {
      target: { value: "-33.6290, 150.3156" },
    });
    expect(box(/^Latitude/).value).toBe("-33.629");
    expect(box(/^Longitude/).value).toBe("150.3156");
  });

  it("keeps other text as typed, and flags it", () => {
    render(dialog(null));
    fireEvent.change(box(/^Latitude/), { target: { value: "-33,6290 150" } });
    expect(box(/^Latitude/).value).toBe("-33,6290 150");
    expect(box(/^Longitude/).value).toBe("");
    fireEvent.blur(box(/^Latitude/));
    expect(screen.getByText(PLACE_FORM.copy.latitudeInvalid)).toBeTruthy();
  });
});
