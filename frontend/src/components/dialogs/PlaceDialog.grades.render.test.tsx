import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import PlaceDialog from "./PlaceDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import type { TPlace, TPlaceType } from "../../placeUtils";

// The simulated regions are declared when shared loads, so the flag is set
// before any import runs. Utah is the simulated region that grades in ACA.
vi.hoisted(() => {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
});

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ media: [] })),
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

const DEFS = SYSTEM_FIELD_DEFS.map((def) => ({
  ...def,
  ownerId: null,
  appliesToAllTypes: false,
  placeTypeIds: def.placeTypes.map((key) => SYSTEM_PLACE_TYPE_IDS[key]),
  tripTypes: [],
})) as unknown as ScopedCustomFieldDef[];

// Made-up points: the Blue Mountains, and the simulated Utah slice.
const NSW = { latitude: -33.74, longitude: 150.31 };
const UTAH = { latitude: 38.27, longitude: -110.8 };

function place(position: typeof NSW, fieldValues = {}): TPlace {
  return {
    id: "p1",
    name: "Made-up gorge",
    altNames: [],
    ...position,
    placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
    fieldValues,
  } as unknown as TPlace;
}

function dialog(p: TPlace | null, initialCoords = null as typeof NSW | null) {
  return (
    <ToastProvider>
      <PlaceDialog
        place={p}
        open
        onClose={() => {}}
        onSaved={() => {}}
        onPickCoords={() => {}}
        onCancelPickCoords={() => {}}
        customFieldDefs={DEFS}
        onCustomFieldDefsChange={() => {}}
        placeTypes={[CANYON]}
        initialCoords={initialCoords}
      />
    </ToastProvider>
  );
}

const has = (label: string) => screen.queryByText(label) !== null;

describe("PlaceDialog, a canyon's grade fields", () => {
  // Mutation: hand the form every definition in PlaceDialog, in place of
  // `placeFormDefs`' answer: all seven grade fields, wherever the canyon is.
  it("are the French ones in NSW and the ACA ones in Utah", () => {
    const nsw = render(dialog(place(NSW)));
    expect(has("V grade")).toBe(true);
    expect(has("ACA water")).toBe(false);
    nsw.unmount();

    render(dialog(place(UTAH)));
    expect(has("ACA water")).toBe(true);
    expect(has("ACA technical")).toBe(true);
    expect(has("V grade")).toBe(false);
  });

  // Mutation: hand `placeFormDefs` no field values in PlaceDialog, and an ACA
  // value on a canyon in NSW is saved away.
  it("keep a field the canyon already holds a value for, in either system", () => {
    render(dialog(place(NSW, { aca_water: 5 })));
    expect(has("V grade")).toBe(true);
    expect(has("ACA water")).toBe(true);
    expect(has("ACA risk")).toBe(false);
    expect(
      screen.getByRole("radio", { name: "C2" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  // Mutation: pass `null` for the position in the `placeFormDefs` call.
  it("follow the coordinates as they are typed", () => {
    render(dialog(place(NSW)));
    expect(has("ACA water")).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: /Latitude/ }), {
      target: { value: "38.27" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Longitude/ }), {
      target: { value: "-110.8" },
    });
    expect(has("ACA water")).toBe(true);
    expect(has("V grade")).toBe(false);
  });

  // Mutation: drop `place?.fieldValues` from the `placeFormDefs` call in
  // PlaceDialog: the field a user cleared would vanish under the cursor.
  it("stay after the user clears a stored value, until it is saved", () => {
    render(dialog(place(NSW, { aca_water: 5 })));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "ACA water" })).getByRole(
        "radio",
        { name: "—" },
      ),
    );
    expect(has("ACA water")).toBe(true);
  });

  // Mutation: drop the form's typed values from the `placeFormDefs` call in
  // PlaceDialog: a grade picked in Utah is lost when the position moves.
  it("keep a field the user filled in, when the position moves out of its system", () => {
    render(dialog(place(UTAH)));
    fireEvent.click(screen.getByRole("radio", { name: "C2" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Latitude/ }), {
      target: { value: "-33.74" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Longitude/ }), {
      target: { value: "150.31" },
    });
    expect(has("V grade")).toBe(true);
    expect(has("ACA water")).toBe(true);
    expect(has("ACA risk")).toBe(false);
  });

  // Mutation: make `gradeSystemAt` answer "aca" for a null position.
  it("start French with no position yet", () => {
    render(dialog(null));
    expect(has("V grade")).toBe(true);
    expect(has("ACA water")).toBe(false);
  });
});
