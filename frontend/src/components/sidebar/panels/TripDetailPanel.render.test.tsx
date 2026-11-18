import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAUGE_PREFIX, gaugeLatestPath } from "@logjam/shared";
import type { TTripLog } from "../../../placeUtils";
import TripDetailPanel from "./TripDetailPanel";

vi.mock("../../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  getTripLog: vi.fn(async () => ({ media: [] })),
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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const trip = {
  id: "t1",
  date: "2026-03-01T00:00:00.000Z",
  notes: "**a**",
  places: [],
  types: [],
  fieldValues: {},
  media: [],
} as unknown as TTripLog;

describe("the trip panel's notes", () => {
  // Mutation: draw `trip.notes` as a raw paragraph again, and Markdown in a
  // trip's notes shows as typed.
  it("draw as Markdown through NoteBody", () => {
    const noop = vi.fn();
    const { container } = render(
      <TripDetailPanel
        tripLog={trip}
        places={[]}
        customFieldDefs={[]}
        onCustomFieldDefsChange={noop}
        existingTripTypes={[]}
        onBack={noop}
        onOpenPlace={noop}
        onRefetchTripLogs={noop}
        onRefetchPlaces={noop}
        onQuotaChanged={noop}
        onPickCoords={noop}
        pickingCoords={false}
        onAfterDelete={noop}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("a");
  });
});

describe("the trip panel's river gauge", () => {
  const inNsw = {
    id: "p1",
    latitude: -33.7,
    longitude: 150.3,
    gaugeId: "900001",
  };
  const outside = {
    id: "p2",
    latitude: -45.1,
    longitude: 169.2,
    gaugeId: "900002",
  };
  const panel = (places: object[]) => {
    const noop = vi.fn();
    render(
      <TripDetailPanel
        tripLog={{
          ...trip,
          places: (places as { id: string }[]).map(({ id }) => ({
            id,
            name: id,
          })),
        }}
        places={places as never}
        customFieldDefs={[]}
        onCustomFieldDefsChange={noop}
        existingTripTypes={[]}
        onBack={noop}
        onOpenPlace={noop}
        onRefetchTripLogs={noop}
        onRefetchPlaces={noop}
        onQuotaChanged={noop}
        onPickCoords={noop}
        pickingCoords={false}
        onAfterDelete={noop}
      />,
    );
  };

  // Mutation: read `GAUGE_PREFIX` for every gauge (not the feed of its place's
  // region), and a trip's gauge outside every feed asks the NSW file for it.
  it("reads the feed of each gauge's place, and asks for none of a place outside every region", () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetch);
    panel([outside]);
    expect(fetch).not.toHaveBeenCalled();
    panel([outside, inNsw]);
    expect(fetch.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      `/${gaugeLatestPath(GAUGE_PREFIX)}`,
      `/${GAUGE_PREFIX}history/900001.json`,
    ]);
  });
});
