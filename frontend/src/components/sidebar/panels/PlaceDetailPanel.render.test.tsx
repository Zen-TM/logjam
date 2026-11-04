import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLACE_PAGE } from "@logjam/shared";
import type { TPlace } from "../../../placeUtils";
import PlaceDetailPanel from "./PlaceDetailPanel";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("../../feedback/ToastProvider", () => ({ useToast: () => toast }));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ tripLogs: [], media: [] })),
}));

// jsdom has no matchMedia, ResizeObserver, scrollIntoView or modal <dialog>.
beforeEach(() => {
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

describe("the place panel's coordinates", () => {
  // Mutation: drop `onCopy` from the Coordinates stat (or bring back a separate
  // copy button), and pressing the coordinates writes nothing.
  it("copy where they are pressed, with the place page's sentence", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const noop = vi.fn();
    render(
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
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Coordinates: .*\. Copy$/ }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("-33.71234, 150.31188"),
    );
    expect(toast.success).toHaveBeenCalledWith(PLACE_PAGE.copy.copyPosition);
  });
});
