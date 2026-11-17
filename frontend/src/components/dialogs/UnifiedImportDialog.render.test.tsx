import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  WAY_IMPORT,
  type ScopedCustomFieldDef,
  type TPlace,
  type TUser,
} from "@logjam/shared";

import UnifiedImportDialog from "./UnifiedImportDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import type { TPlaceType } from "../../placeUtils";

// The simulated regions are declared when shared loads, so the flag is set
// before any import runs. Utah is the simulated region that grades in ACA.
vi.hoisted(() => {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
});

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

const CANYON: TPlaceType = {
  id: SYSTEM_PLACE_TYPE_IDS.canyon,
  name: "Canyon",
} as TPlaceType;

// The first row's exact name about 3 km away: too far to link on its own
// (EXACT_NAME_AUTO_DIST_M), so the importer surfaces it for review. Synthetic,
// like the e2e fixture.
const EXISTING: TPlace = {
  id: "existing-alpha",
  name: "Test Alpha Gorge",
  altNames: [],
  latitude: -33.7401,
  longitude: 150.3102,
  placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
  fieldValues: {},
} as unknown as TPlace;

function user(uiPreferences: unknown = null): TUser {
  return {
    id: "alice",
    username: "alice",
    uiPreferences,
  } as unknown as TUser;
}

const CSV =
  "name,latitude,longitude\n" +
  "Test Alpha Gorge,-33.7101,150.3102\n" +
  "Test Bravo Chasm,-33.9202,150.5203\n";

const CAMPSITE: TPlaceType = {
  id: "t-camp",
  name: "Campsite",
} as TPlaceType;

function dialog(
  currentUser: TUser | null,
  { defs = [] as ScopedCustomFieldDef[], places = [EXISTING] } = {},
) {
  return (
    <ToastProvider>
      <UnifiedImportDialog
        open
        onClose={() => {}}
        places={places}
        customFieldDefs={[]}
        onCustomFieldDefsChange={() => {}}
        placeCustomFieldDefs={defs}
        placeTypes={[CANYON, CAMPSITE]}
        currentUser={currentUser}
        onRefetchPlaces={() => {}}
        onRefetchTripLogs={() => {}}
        onPickCoords={() => {}}
      />
    </ToastProvider>
  );
}

async function loadCsv(content = CSV) {
  const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
  const file = new File([content], "places.csv", { type: "text/csv" });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await screen.findByRole("heading", { name: /^Place columns/ });
}

// Mutation: drop the `setImportPlaceTypeId(landsIn)` in the file loader, or
// let an old file without the column change the type.
describe("UnifiedImportDialog, a file that names its type", () => {
  const typeSelect = () =>
    screen.getByRole("combobox", { name: /place type/i }) as HTMLSelectElement;

  it("lands in that type; a file without the column keeps the default", async () => {
    render(dialog(user()));
    await loadCsv(
      "name,latitude,longitude,placeType\n" +
        "Test Alpha Gorge,-33.7101,150.3102,Campsite\n" +
        "Test Bravo Chasm,-33.9202,150.5203,campsite\n",
    );
    expect(typeSelect().value).toBe("t-camp");
  });

  // Mutation: drop the `unknown` toast, and a list of huts lands in Canyon
  // without a word.
  it("says which type it did not find, and keeps the picker's choice", async () => {
    render(dialog(user()));
    await loadCsv(
      "name,latitude,longitude,placeType\n" +
        "Test Alpha Gorge,-33.7101,150.3102,Hut\n",
    );
    expect(
      screen.getByText(
        '"Hut" isn\'t one of your place types, so the picker keeps the type you chose.',
      ),
    ).toBeTruthy();
    expect(typeSelect().value).toBe(SYSTEM_PLACE_TYPE_IDS.canyon);
  });

  it("keeps Canyon for a file without a placeType column", async () => {
    render(dialog(user()));
    await loadCsv();
    expect(typeSelect().value).toBe(SYSTEM_PLACE_TYPE_IDS.canyon);
  });
});

// A refetch, consent, or late first load keeps the loaded file, column map,
// and review intact while open; only reopening starts over.
describe("UnifiedImportDialog, while open", () => {
  it("keeps the loaded file and its column map when the user is refetched", async () => {
    const { rerender } = render(dialog(user()));
    await loadCsv();
    const latitude = screen.getByRole("combobox", {
      name: 'What "latitude" is',
    }) as HTMLSelectElement;
    fireEvent.change(latitude, { target: { value: "discard" } });
    expect(latitude.value).toBe("discard");

    rerender(dialog(user()));

    expect(
      screen.getByRole("heading", { name: /^Place columns/ }),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("combobox", {
          name: 'What "latitude" is',
        }) as HTMLSelectElement
      ).value,
    ).toBe("discard");
  });

  it("keeps the review when the user arrives after the file", async () => {
    const { rerender } = render(dialog(null));
    await loadCsv();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: /^Review/ });
    const reviewText = document.querySelector("dialog")!.textContent;

    rerender(dialog(user()));

    await waitFor(() =>
      expect(document.querySelector("dialog")!.textContent).toBe(reviewText),
    );
  });
});

// Mutation that turns these red: send a GPX through parseCsv again, or put
// "(see console)" back in the parse-warning toast.
describe("UnifiedImportDialog, files that are not a CSV", () => {
  it("refuses a GPX with a message that says what is accepted and where GPX goes", async () => {
    render(dialog(user()));
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File(["<gpx></gpx>"], "route.gpx", {
      type: "application/gpx+xml",
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    const text = document.querySelector("dialog")!.textContent!;
    expect(text).toContain('"route.gpx" isn\'t a CSV');
    expect(text).toContain(
      `open Ways and choose Add, then “${WAY_IMPORT.menu}”`,
    );
    expect(text).not.toContain("see console");
  });
});

describe("UnifiedImportDialog, confirm step", () => {
  it("names the skipped row and hides Merge settings when nothing matches", async () => {
    render(dialog(user()));
    const input = document.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File(
      [
        "name,latitude,longitude\n" +
          "Test Bravo Chasm,-33.9202,150.5203\n" +
          "Test Charlie Cave,not-a-number,150.1\n",
      ],
      "places.csv",
      { type: "text/csv" },
    );
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await screen.findByRole("heading", { name: /^Place columns/ });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText(/ready to import/);
    const text = document.querySelector("dialog")!.textContent!;
    expect(text).toContain("1 row can't be read and will be skipped (row 3).");
    expect(text).not.toContain("Merge settings");
  });
});

// The columns a Canyon list maps onto are the definitions of the Canyon type
// as the server sends them: the French three and the ACA four.
const BUILT_IN = SYSTEM_FIELD_DEFS.map((def) => ({
  ...def,
  ownerId: null,
  appliesToAllTypes: false,
  placeTypeIds: def.placeTypes.map((key) => SYSTEM_PLACE_TYPE_IDS[key]),
  tripTypes: [],
})) as unknown as ScopedCustomFieldDef[];

describe("UnifiedImportDialog, the grade columns a canyon list maps onto", () => {
  const ACA_CSV =
    "name,latitude,longitude,ACA technical,Commitment\n" +
    "Test Alpha Gorge,-33.7101,150.3102,3,2\n";
  const choice = (header: string) =>
    screen.getByRole("combobox", {
      name: `What "${header}" is`,
    }) as HTMLSelectElement;
  const offers = (header: string, value: string) =>
    [...choice(header).options].some((option) => option.value === value);

  // Mutation: build `importDefsFor` in `UnifiedImportDialog` from `defsForType`
  // alone, without `listedAttributeDefs`.
  it("leave out the ACA ones over NSW, and keep the French ones", async () => {
    render(dialog(user({ regions: ["nsw"] }), { defs: BUILT_IN }));
    await loadCsv(ACA_CSV);
    expect(offers("ACA technical", "attr:aca_technical")).toBe(false);
    expect(choice("ACA technical").value).toBe("discard");
    expect(choice("Commitment").value).toBe("commitment");
  });

  // Mutation: filter with the French system whatever the account, in
  // `listedAttributeDefs` (`canyonGrade.ts`).
  it("offer the ACA ones, and detect their column, for an account in Utah", async () => {
    render(dialog(user({ regions: ["simutah"] }), { defs: BUILT_IN }));
    await loadCsv(ACA_CSV);
    expect(choice("ACA technical").value).toBe("attr:aca_technical");
  });

  // Mutation: drop the `places` argument from the `listedAttributeDefs` call
  // in `importDefsFor`.
  it("offer an ACA one over NSW when a place of the user's holds a value on it", async () => {
    const graded = {
      ...EXISTING,
      fieldValues: { aca_technical: 2 },
    } as unknown as TPlace;
    render(
      dialog(user({ regions: ["nsw"] }), {
        defs: BUILT_IN,
        places: [graded],
      }),
    );
    await loadCsv(ACA_CSV);
    expect(choice("ACA technical").value).toBe("attr:aca_technical");
    expect(offers("ACA technical", "attr:aca_water")).toBe(false);
  });
});
