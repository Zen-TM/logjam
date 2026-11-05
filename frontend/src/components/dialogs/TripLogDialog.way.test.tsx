import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TripLogDialog from "./TripLogDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { CurrentUserIdContext } from "../../CurrentUserIdContext";
import { createTripLog, uploadMedia } from "../../placeUtils";

const recording = {
  id: "rec-1",
  mediaType: "application/gpx+xml",
  filename: "descent.gpx",
  displayName: null,
  fileSizeBytes: 10,
  color: null,
  origin: "track",
  metadata: {},
  linkedPlaceId: null,
  hasTrip: false,
  createdAt: "",
  updatedAt: "",
};

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getMediaDownloadUrls: vi.fn(async () => ({
    items: [{ id: "rec-1", displayUrl: "https://files.test/rec.gpx" }],
  })),
  useRoutes: () => ({
    routes: [
      {
        id: "r1",
        ownerId: "alice",
        placeId: "p-1",
        name: "Creek line",
        points: [
          [150.1, -33.1],
          [150.2, -33.2],
        ],
      },
      { id: "r2", ownerId: "bob", placeId: null, name: "Not mine", points: [] },
    ],
    error: null,
    loaded: true,
    refetch: () => {},
  }),
  useStandaloneFiles: () => ({
    files: [recording],
    error: null,
    loaded: true,
    refetch: () => {},
  }),
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

function open() {
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
        />
      </CurrentUserIdContext.Provider>
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add a way" }));
}

beforeEach(() => {
  vi.mocked(uploadMedia).mockClear();
  vi.mocked(createTripLog).mockClear();
});
afterEach(cleanup);

describe("Add a way on the trip form", () => {
  it("offers the sources of a place's slot, without the pen", () => {
    open();
    for (const name of [
      "Choose a route you drew",
      "Use a recorded track",
      "Use an imported file",
      "Upload a file",
    ])
      expect(screen.getByText(name)).toBeTruthy();
    expect(screen.queryByText("Draw a route on the map")).toBeNull();
  });

  // Mutation: filter through attachableRoutes (place-slot rules) and the route
  // sitting on a place disappears from a trip's list.
  it("copies a drawn route of the user's, even one on a place, as a GPX", async () => {
    open();
    fireEvent.click(screen.getByText("Choose a route you drew"));
    expect(screen.queryByText("Not mine")).toBeNull();
    fireEvent.click(screen.getByText("Creek line"));
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    const call = vi.mocked(uploadMedia).mock.calls[0][0];
    expect(call).toMatchObject({ linkedType: "tripLog", linkedId: "trip-1" });
    expect(call.file.name).toBe("Creek line.gpx");
    expect(call.sourceMediaId).toBeUndefined();
  });

  // Mutation: drop `sourceMediaId` for a recording and it keeps offering
  // "Log a trip" after one was logged from it.
  it("copies a recorded track naming the recording", async () => {
    open();
    fireEvent.click(screen.getByText("Use a recorded track"));
    fireEvent.click(await screen.findByText("descent.gpx"));
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1));
    expect(vi.mocked(uploadMedia).mock.calls[0][0]).toMatchObject({
      linkedId: "trip-1",
      sourceMediaId: "rec-1",
    });
  });
});
