import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLACE_FORM,
  PLACE_PAGE,
  SOURCES_FIELD_KEY,
  SYSTEM_PLACE_TYPE_IDS,
} from "@logjam/shared";

import PlaceDialog from "./PlaceDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { deleteMedia, updatePlace } from "../../placeUtils";
import { ApiError } from "../../errors/ApiError";
import type { TPlace, TPlaceType } from "../../placeUtils";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ media: [] })),
  deleteMedia: vi.fn(async () => {}),
  updatePlace: vi.fn(async () => ({})),
}));
// The real one needs a file chooser: this one "uploads" (m1, m2, ...) on a
// press, and reports a slow one on another.
const upload = vi.hoisted(() => ({ n: 0 }));
vi.mock("../media/MediaUpload", () => ({
  default: ({
    onUploaded,
    onBusyChange,
  }: {
    onUploaded: (item: unknown) => void;
    onBusyChange: (busy: boolean) => void;
  }) => (
    <>
      <button
        type="button"
        onClick={() =>
          onUploaded({ id: `m${++upload.n}`, mediaType: "image/jpeg" })
        }
      >
        Fake upload
      </button>
      <button type="button" onClick={() => onBusyChange(true)}>
        Start slow upload
      </button>
      <button type="button" onClick={() => onBusyChange(false)}>
        Finish slow upload
      </button>
    </>
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

// The form names its route section and its empty slot with the words the place
// page uses. Mutation: write either back as a literal ("Track", "No track yet.").
describe("PlaceDialog, route section", () => {
  it("says route where the place page does", async () => {
    render(dialog(place("p1", "Claustral")));
    expect(
      (await screen.findByRole("heading", { name: PLACE_PAGE.copy.route }))
        .textContent,
    ).toBe("Route");
    expect(await screen.findByText(PLACE_PAGE.copy.routeEmpty)).toBeTruthy();
  });
});

// Uploads land on the server the moment they finish, so Discard has to take
// them back out. Mutations: drop `uploadedIds` from `isDirty`; move
// `onGone` out of `discardUploads`'s loop (a retry then deletes the first file
// twice); treat a 404 as a failure; drop `uploading` from the Cancel button.
describe("PlaceDialog, editing, after an upload", () => {
  const onClose = vi.fn();
  beforeEach(() => {
    upload.n = 0;
    onClose.mockClear();
    vi.mocked(deleteMedia).mockReset();
    vi.mocked(deleteMedia).mockResolvedValue(undefined);
  });

  const open = () => {
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
  };
  const upload1 = () => fireEvent.click(screen.getAllByText("Fake upload")[0]);
  const cancel = () =>
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const discard = () =>
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

  it("asks before closing, and deletes the upload on Discard", async () => {
    open();
    upload1();
    cancel();
    expect(onClose).not.toHaveBeenCalled();
    expect(deleteMedia).not.toHaveBeenCalled();

    discard();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(deleteMedia).toHaveBeenCalledWith("m1");
  });

  it("stays open when a delete fails, and a retry deletes only what is left", async () => {
    open();
    upload1();
    upload1();
    vi.mocked(deleteMedia)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("offline"));
    cancel();
    discard();
    await screen.findByText(/Couldn't discard uploaded files/);
    expect(onClose).not.toHaveBeenCalled();
    expect(vi.mocked(deleteMedia).mock.calls).toEqual([["m1"], ["m2"]]);

    cancel();
    discard();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(deleteMedia).mock.calls).toEqual([["m1"], ["m2"], ["m2"]]);
  });

  it("counts a file the server no longer has as deleted", async () => {
    open();
    upload1();
    vi.mocked(deleteMedia).mockRejectedValueOnce(
      new ApiError(404, "/media/m1", "DELETE"),
    );
    cancel();
    discard();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("holds Cancel while a file is still uploading", () => {
    open();
    fireEvent.click(screen.getAllByText("Start slow upload")[0]);
    expect(
      screen
        .getByRole("button", { name: "Cancel" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getAllByText("Finish slow upload")[0]);
    expect(
      screen
        .getByRole("button", { name: "Cancel" })
        .getAttribute("aria-disabled"),
    ).toBeNull();
  });
});

const save = () =>
  fireEvent.click(
    screen.getByRole("button", { name: PLACE_FORM.copy.saveSubmit }),
  );

// A refetch can land while the dialog is open. A save sends what the user
// changed, never the text the dialog opened with.
describe("PlaceDialog, saving an edit", () => {
  beforeEach(() => vi.mocked(updatePlace).mockClear());

  const stored = (notes: string, link: string, latitude = -33.74): TPlace =>
    ({
      ...place("p1", "Alpha Gorge"),
      latitude,
      notes,
      fieldValues: { [SOURCES_FIELD_KEY]: [["Guide", link]] },
    }) as unknown as TPlace;

  // Mutation: build the save from every form field again, or compare the
  // sources with the place as it is by then, and the notes and the source list
  // the refetch brought in are overwritten by the ones the dialog opened with.
  it("leaves a field alone that a refetch changed while it was open", async () => {
    const { rerender } = render(
      dialog(stored("Old note", "https://old.example")),
    );
    fireEvent.change(nameBox(), { target: { value: "Alpha Gorge 2" } });

    rerender(dialog(stored("Newer note", "https://new.example", -33.8)));
    save();

    await waitFor(() => expect(updatePlace).toHaveBeenCalledTimes(1));
    expect(updatePlace).toHaveBeenCalledWith("p1", { name: "Alpha Gorge 2" });
  });

  // Mutation: leave the coordinates out of `placeEditChanges`'s result, or pass
  // `touched` false for them, and a typed position is never sent.
  it("sends a position the user typed, over the one a pull brought in", async () => {
    const { rerender } = render(
      dialog(stored("Old note", "https://old.example")),
    );
    fireEvent.change(box(/^Latitude/), { target: { value: "-33.9" } });

    rerender(dialog(stored("Old note", "https://old.example", -33.8)));
    save();

    await waitFor(() => expect(updatePlace).toHaveBeenCalledTimes(1));
    expect(updatePlace).toHaveBeenCalledWith("p1", { latitude: -33.9 });
  });

  // Mutation: send every field once any one changed, and the name, position
  // and sources travel with the notes.
  it("builds a changed notes field and nothing else over the place as it is", async () => {
    const { rerender } = render(
      dialog(stored("Old note", "https://old.example")),
    );
    fireEvent.change(screen.getByLabelText(/^Notes/), {
      target: { value: "Mine" },
    });

    rerender(dialog(stored("Newer note", "https://new.example")));
    save();

    await waitFor(() => expect(updatePlace).toHaveBeenCalledTimes(1));
    expect(updatePlace).toHaveBeenCalledWith("p1", { notes: "Mine" });
  });

  // Mutation: run the sources check after the early return for the other
  // checks again, and the link's error shows only on the second press.
  it("shows a bad link's error on the first press, with the other errors", async () => {
    render(dialog(place("p1", "Alpha Gorge")));
    fireEvent.change(nameBox(), { target: { value: "" } });
    fireEvent.click(
      screen.getByRole("button", { name: PLACE_FORM.copy.addSource }),
    );
    fireEvent.change(screen.getByLabelText(PLACE_FORM.copy.sourceLabel), {
      target: { value: "Guide" },
    });
    fireEvent.change(screen.getByLabelText(PLACE_FORM.copy.sourceLink), {
      target: { value: "javascript:alert(1)" },
    });
    save();

    expect(
      await screen.findByText(PLACE_FORM.copy.sourceLinkInvalid),
    ).toBeTruthy();
    expect(screen.getByText(PLACE_FORM.copy.nameMissing)).toBeTruthy();
    expect(updatePlace).not.toHaveBeenCalled();
  });
});
