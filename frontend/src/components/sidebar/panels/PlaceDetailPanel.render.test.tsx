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
  done: vi.fn(),
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
      onExportPlace={noop}
      onWaysChanged={noop}
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
    expect(toast.done).toHaveBeenCalledWith(PLACE_PAGE.copy.copyPosition);
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
  it("offers the four sources an owner has, with Logjam GPS's words", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: ADD_WAY.copy.title }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: ADD_WAY.copy.title,
    });
    for (const title of [
      ADD_WAY.copy.routeTitle,
      ADD_WAY.copy.trackTitle,
      ADD_WAY.copy.importTitle,
      "Upload a file",
    ])
      expect(
        within(dialog).getByRole("button", { name: new RegExp(title) }),
      ).toBeTruthy();
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
    expect(toast.done).toHaveBeenCalledWith(ADD_WAY.copy.routeDone);
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
      ["m2", "p1"],
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
    expect(toast.done).toHaveBeenCalledWith(ADD_WAY.copy.fileDone);
  });
});
