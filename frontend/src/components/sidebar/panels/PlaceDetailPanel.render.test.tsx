import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADD_WAY, PLACE_PAGE, type MediaItem } from "@logjam/shared";
import type { TPlace, TRoute } from "../../../placeUtils";
import PlaceDetailPanel from "./PlaceDetailPanel";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));
const api = vi.hoisted(() => ({
  getPlaceDetail: vi.fn(),
  updateRoute: vi.fn(async () => ({ displacedRoute: null })),
  linkMediaToPlace: vi.fn(async () => ({})),
  uploadMedia: vi.fn(async () => ({})),
  deleteMedia: vi.fn(async () => {}),
  files: [] as unknown[],
  useStandaloneFiles: () => ({ files: api.files, loaded: true, error: null }),
}));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  ...api,
}));

// jsdom has no matchMedia, ResizeObserver, scrollIntoView or modal <dialog>.
beforeEach(() => {
  api.getPlaceDetail.mockResolvedValue({ tripLogs: [], media: [] });
  api.files = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.scrollIntoView = () => {};
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const place = {
  id: "p1",
  ownerId: "alice",
  name: "Claustral",
  altNames: [],
  latitude: -33.71234,
  longitude: 150.31188,
  elevation: null,
  placeTypeId: "b0000000-0000-4000-8000-000000000001",
  notes: null,
  fieldValues: {},
  media: [],
  linkedPlaceIds: [],
  sharedWith: [],
} as unknown as TPlace;

const noop = vi.fn();

function renderPanel(
  props: Partial<ComponentProps<typeof PlaceDetailPanel>> = {},
) {
  return render(
    <PlaceDetailPanel
      place={place}
      places={[place]}
      isOwnedPlace
      friends={[]}
      onRefetch={noop}
      onRefetchShared={noop}
      setSelectedPlaceID={noop}
      onPickCoords={noop}
      pickingCoords={false}
      onCancelPickCoords={noop}
      onBack={noop}
      onOpenTrip={noop}
      onMakeMap={noop}
      onSharePlace={noop}
      verbRequest={null}
      onVerbRequestConsumed={noop}
      customFieldDefs={[]}
      placeTypes={[]}
      onCustomFieldDefsChange={noop}
      placeCustomFieldDefs={[]}
      onPlaceCustomFieldDefsChange={noop}
      onQuotaChanged={noop}
      onRefetchTripLogs={noop}
      onAfterDelete={noop}
      routes={[]}
      currentUserId="alice"
      onFocusBounds={noop}
      onOpenRoute={noop}
      onRoutesChanged={noop}
      onDrawRoute={noop}
      {...props}
    />,
  );
}

describe("the place panel's coordinates", () => {
  // Mutation: drop `onCopy` from the Coordinates stat (or bring back a separate
  // copy button), and pressing the coordinates writes nothing.
  it("copy where they are pressed, with the place page's sentence", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: /^Coordinates: .*\. Copy$/ }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("-33.71234, 150.31188"),
    );
    expect(toast.success).toHaveBeenCalledWith(PLACE_PAGE.copy.copyPosition);
  });
});

const route = (over: Partial<TRoute>): TRoute => ({
  id: "r1",
  ownerId: "alice",
  placeId: null,
  name: "Claustral line",
  color: "#fff",
  points: [
    [-33.7, 150.3],
    [-33.71, 150.31],
  ],
  anchors: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const trackFile = {
  id: "m1",
  mediaType: "application/gpx+xml",
  filename: "old.gpx",
  displayName: null,
  origin: "import",
} as unknown as MediaItem;

describe("adding a route from the place page", () => {
  // Mutation: render the button without `isOwnedPlace &&`, or drop the
  // `AddWayDialog` from the Route section, and this goes red.
  it("offers the five sources an owner has, with Logjam GPS's words", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.title }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    for (const title of [
      ADD_WAY.copy.routeTitle,
      ADD_WAY.copy.drawTitle,
      ADD_WAY.copy.trackTitle,
      ADD_WAY.copy.importTitle,
      "Upload a file",
    ])
      expect(
        within(dialog).getByRole("button", { name: new RegExp(title) }),
      ).toBeTruthy();
  });

  // Mutation: drop `onDrawRoute(current.id)` from the dialog's draw row, or
  // pass another id: the pen would arm for no place, or the wrong one.
  it("hands the map's pen this place when asked to draw", async () => {
    const onDrawRoute = vi.fn();
    renderPanel({ onDrawRoute });
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.title }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: new RegExp(ADD_WAY.copy.drawTitle),
      }),
    );
    expect(onDrawRoute).toHaveBeenCalledWith("p1");
  });

  // Mutation: drop the `isOwnedPlace` guard, and a sharee is offered a write
  // the API refuses.
  it("gives a sharee no button", async () => {
    renderPanel({ isOwnedPlace: false });
    await screen.findByText("No route yet.");
    expect(
      screen.queryByRole("button", { name: ADD_WAY.copy.title }),
    ).toBeNull();
  });

  // Mutation: point the write at the wrong id, or skip `updateRoute`.
  it("links a drawn route of the user's own, and not someone else's", async () => {
    const onRoutesChanged = vi.fn();
    renderPanel({
      routes: [
        route({ id: "mine", name: "Mine" }),
        route({ id: "theirs", name: "Theirs", ownerId: "bob" }),
      ],
      onRoutesChanged,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.title }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(ADD_WAY.copy.routeTitle),
      }),
    );
    expect(screen.queryByRole("button", { name: /Theirs/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Mine/ }));
    await waitFor(() =>
      expect(api.updateRoute).toHaveBeenCalledWith("mine", { placeId: "p1" }),
    );
    expect(toast.success).toHaveBeenCalledWith(ADD_WAY.copy.routeDone);
    expect(onRoutesChanged).toHaveBeenCalled();
  });

  // Mutation: skip the confirm, and a replaced route is unlinked unasked.
  it("asks before replacing, then links the new way and unlinks the old", async () => {
    renderPanel({
      routes: [
        route({ id: "old", name: "Old line", placeId: "p1" }),
        route({ id: "new", name: "New line" }),
      ],
    });
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.replaceTitle }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(ADD_WAY.copy.routeTitle),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /New line/ }));
    expect(
      await screen.findByText("Claustral already has a route"),
    ).toBeTruthy();
    expect(api.updateRoute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(api.updateRoute).toHaveBeenCalledTimes(2));
    expect(api.updateRoute.mock.calls).toEqual([
      ["new", { placeId: "p1" }],
      ["old", { placeId: null }],
    ]);
  });

  // Mutation: link the new file before unlinking the old, and the API's 409
  // ("This place already has a track") lands the link nowhere.
  it("unlinks a file in the slot before linking another", async () => {
    api.getPlaceDetail.mockResolvedValue({ tripLogs: [], media: [trackFile] });
    api.files = [
      {
        id: "m2",
        mediaType: "application/gpx+xml",
        filename: "walk.gpx",
        displayName: null,
        origin: "import",
        metadata: {},
        linkedPlaceId: null,
      },
    ];
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.replaceTitle }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(ADD_WAY.copy.importTitle),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /walk\.gpx/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await waitFor(() => expect(api.linkMediaToPlace).toHaveBeenCalledTimes(2));
    expect(api.linkMediaToPlace.mock.calls).toEqual([
      ["m1", null],
      ["m2", "p1", undefined],
    ]);
  });

  // Mutation: skip the extension check, and a photo picked here is uploaded as
  // the place's route.
  it("uploads a GPX or KML onto the place, and refuses anything else", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.title }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    const input = dialog.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "pic.png", { type: "image/png" })] },
    });
    expect(
      await within(dialog).findByText(ADD_WAY.copy.notRouteFile),
    ).toBeTruthy();
    expect(api.uploadMedia).not.toHaveBeenCalled();

    fireEvent.change(input, {
      target: { files: [new File(["<gpx/>"], "line.gpx")] },
    });
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));
    expect(api.uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedType: "place",
        linkedId: "p1",
        mediaType: "application/gpx+xml",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(ADD_WAY.copy.fileDone);
  });

  const gpxFile = (name = "line.gpx", size = 6) =>
    new File([new Uint8Array(size)], name);

  // Mutation: route the confirm through the "kept" wording for every file, and
  // an uploaded GPX is deleted on a promise that it is kept.
  it("says an uploaded file in the slot will be deleted, and has the upload replace it", async () => {
    api.getPlaceDetail.mockResolvedValue({
      tripLogs: [],
      media: [{ ...trackFile, origin: null }],
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.replaceTitle }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, {
      target: { files: [gpxFile()] },
    });
    expect(await screen.findByText(/will be deleted/)).toBeTruthy();
    expect(api.uploadMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(api.uploadMedia).toHaveBeenCalledTimes(1));
    // Mutation: delete it here before the upload again, and a rejected upload
    // leaves the place with no route and the old file gone.
    expect(api.uploadMedia).toHaveBeenCalledWith(
      expect.objectContaining({ replaces: "m1" }),
    );
    expect(api.deleteMedia).not.toHaveBeenCalled();
  });

  it("keeps the uploaded file in the slot when the replacing upload fails", async () => {
    api.getPlaceDetail.mockResolvedValue({
      tripLogs: [],
      media: [{ ...trackFile, origin: null }],
    });
    api.uploadMedia.mockRejectedValueOnce(new Error("quota"));
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.replaceTitle }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, {
      target: { files: [gpxFile()] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    expect(await within(dialog).findByText(ADD_WAY.copy.failed)).toBeTruthy();
    expect(api.deleteMedia).not.toHaveBeenCalled();
    expect(api.linkMediaToPlace).not.toHaveBeenCalled();
  });

  // Mutation: move the size check after the upload, and an oversize pick is
  // sent to the API only to be refused there.
  it("refuses an oversize file before the upload in the slot is deleted", async () => {
    api.getPlaceDetail.mockResolvedValue({
      tripLogs: [],
      media: [{ ...trackFile, origin: null }],
    });
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.replaceTitle }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    const big = gpxFile("big.gpx");
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    fireEvent.change(dialog.querySelector('input[type="file"]')!, {
      target: { files: [big] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    expect(await within(dialog).findByText(ADD_WAY.copy.tooLarge)).toBeTruthy();
    expect(api.deleteMedia).not.toHaveBeenCalled();
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });

  // Mutation: drop `onFilled()` from the catch, and a write that failed after
  // the old way was taken out leaves the page showing the old way.
  it("keeps the dialog open with the banner, and refreshes the page, when the write fails", async () => {
    api.uploadMedia.mockRejectedValueOnce(new Error("boom"));
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.title }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    const before = api.getPlaceDetail.mock.calls.length;
    fireEvent.change(dialog.querySelector('input[type="file"]')!, {
      target: { files: [gpxFile()] },
    });
    expect(await within(dialog).findByText(ADD_WAY.copy.failed)).toBeTruthy();
    expect(api.getPlaceDetail.mock.calls.length).toBeGreaterThan(before);
    expect(toast.success).not.toHaveBeenCalled();
  });

  // Mutation: show `failed` for a removal that follows a successful write.
  it("says the new route is in place when only the old one could not be removed", async () => {
    const onRoutesChanged = vi.fn();
    api.updateRoute
      .mockResolvedValueOnce({ displacedRoute: null })
      .mockRejectedValueOnce(new Error("503"));
    renderPanel({
      routes: [
        route({ id: "old", name: "Old line", placeId: "p1" }),
        route({ id: "new", name: "New line" }),
      ],
      onRoutesChanged,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.replaceTitle }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(ADD_WAY.copy.routeTitle),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /New line/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(ADD_WAY.copy.removalFailed),
    );
    expect(onRoutesChanged).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalledWith(ADD_WAY.copy.failed);
  });

  // Mutation: show Delete for a linked import, and the only way off the place
  // destroys the user's file.
  it("unlinks a linked import from the page and only deletes an upload", async () => {
    api.getPlaceDetail.mockResolvedValue({
      tripLogs: [],
      media: [trackFile],
    });
    const { unmount } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Unlink from this place" }),
    );
    await waitFor(() =>
      expect(api.linkMediaToPlace).toHaveBeenCalledWith("m1", null),
    );
    expect(
      screen.queryByRole("button", { name: /^Delete the track/ }),
    ).toBeNull();
    unmount();

    api.getPlaceDetail.mockResolvedValue({
      tripLogs: [],
      media: [{ ...trackFile, origin: null }],
    });
    renderPanel();
    expect(
      await screen.findByRole("button", { name: "Delete the track old.gpx" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Unlink from this place" }),
    ).toBeNull();
  });
});
