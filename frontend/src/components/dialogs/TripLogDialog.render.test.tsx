import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_PLACE_TYPE_IDS } from "@logjam/shared";

import TripLogDialog, { type TripLogPrefill } from "./TripLogDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import type { TPlace } from "../../placeUtils";

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
