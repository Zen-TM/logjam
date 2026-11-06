import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
