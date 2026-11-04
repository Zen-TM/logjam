import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import TripLogDialog from "./TripLogDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { CurrentUserIdContext } from "../../CurrentUserIdContext";
import { createTripLog, uploadMedia } from "../../placeUtils";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getMediaDownloadUrls: vi.fn(async () => ({
    items: [{ id: "rec-1", displayUrl: "https://files.test/rec.gpx" }],
  })),
  createTripLog: vi.fn(async () => ({ id: "trip-1" })),
  uploadMedia: vi.fn(async () => ({ id: "copy-1" })),
}));

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
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("<gpx/>")),
);

afterEach(cleanup);

describe("Log a trip from a recording", () => {
  // Mutation: drop `sourceMediaId` from the uploadMedia call in TripLogDialog,
  // and the recording never learns a trip was logged from it.
  it("attaches the copy with the recording it came from", async () => {
    render(
      <ToastProvider>
        <CurrentUserIdContext.Provider value="alice">
          <TripLogDialog
            open
            onClose={vi.fn()}
            onSaved={vi.fn()}
            places={[]}
            customFieldDefs={[]}
            onCustomFieldDefsChange={vi.fn()}
            existingTripTypes={[]}
            fromTrack={{
              mediaId: "rec-1",
              filename: "descent.gpx",
              startedAt: null,
              placeId: null,
            }}
          />
        </CurrentUserIdContext.Provider>
      </ToastProvider>,
    );
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    expect(createTripLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadMedia).mock.calls[0][0]).toMatchObject({
      linkedType: "tripLog",
      linkedId: "trip-1",
      sourceMediaId: "rec-1",
    });
  });
});
