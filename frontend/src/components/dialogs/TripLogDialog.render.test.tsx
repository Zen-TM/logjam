import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

import TripLogDialog, { type TripLogPrefill } from "./TripLogDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { deleteMedia } from "../../placeUtils";
import { ApiError } from "../../errors/ApiError";
import type { TPlace, TTripLog } from "../../placeUtils";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getTripLog: vi.fn(async () => ({ media: [] })),
  deleteMedia: vi.fn(async () => {}),
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

const prefill: TripLogPrefill = {
  date: "2026-11-07",
  notes: "",
  displayName: "Wollangambe trip",
  types: [],
  placeIds: ["copy-a", "copy-b"],
  placeTypeIds: [SYSTEM_PLACE_TYPE_IDS.canyon],
};

function dialog(places: TPlace[]) {
  return (
    <ToastProvider>
      <TripLogDialog
        open
        onClose={() => {}}
        onSaved={() => {}}
        places={places}
        prefill={prefill}
        customFieldDefs={[]}
        onCustomFieldDefsChange={() => {}}
        existingTripTypes={[]}
      />
    </ToastProvider>
  );
}

describe("a trip log started from a plan", () => {
  // Mutation: drop the `prefill ? prefill.placeIds :` branch, and the form
  // opens with none of the plan's places linked.
  it("opens with the plan's places linked", () => {
    render(dialog([place("copy-a", "Wollangambe"), place("copy-b", "Bowens")]));
    expect(screen.getByText(/Wollangambe and Bowens/)).toBeTruthy();
  });

  // Mutation: drop the `prefill ? prefill.placeTypeIds :` branch, and a
  // canyon copied a moment ago, not yet in the place list, tags nothing.
  it("tags a canyon before the place list has it", () => {
    render(dialog([]));
    expect(
      screen.getByRole("button", { name: /canyoning/i, pressed: true }),
    ).toBeTruthy();
  });
});

// Uploads land on the server the moment they finish, so Discard has to take
// them back out. Mutations: drop `uploadedIds` from `isDirty`; move
// `onGone` out of `discardUploads`'s loop (a retry then deletes the first file
// twice); treat a 404 as a failure; drop `uploading` from the Cancel button.
describe("a trip log being edited, after an upload", () => {
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
        <TripLogDialog
          open
          tripLog={
            {
              id: "t1",
              date: "2026-11-07",
              notes: null,
              places: [],
              displayName: "Wollangambe trip",
              types: [],
              customFields: {},
            } as unknown as TTripLog
          }
          onClose={onClose}
          onSaved={() => {}}
          places={[]}
          customFieldDefs={[]}
          onCustomFieldDefsChange={() => {}}
          existingTripTypes={[]}
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
