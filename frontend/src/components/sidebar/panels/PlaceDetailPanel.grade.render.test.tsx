import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedCustomFieldDef } from "@logjam/shared";
import type { TPlace } from "../../../placeUtils";
import PlaceDetailPanel from "./PlaceDetailPanel";

vi.mock("../../gauges/useGauges", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../gauges/useGauges")>()),
  useGauges: () => ({ file: null, failed: false, now: Date.now() }),
}));
vi.mock("../../feedback/ToastProvider", () => ({
  useToast: () => ({ done: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  getPlaceDetail: vi.fn(async () => ({ tripLogs: [], media: [] })),
  getPlaceShares: vi.fn(async () => []),
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
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const placeWith = (fieldValues: Record<string, unknown>) =>
  ({
    id: "p1",
    ownerId: "alice",
    name: "Claustral",
    altNames: [],
    latitude: -33.71234,
    longitude: 150.31188,
    elevation: null,
    placeTypeId: "b0000000-0000-4000-8000-000000000001",
    notes: null,
    fieldValues,
    media: [],
    linkedPlaceIds: [],
    sharedWith: [],
  }) as unknown as TPlace;

const userGrade = {
  key: "grade",
  label: "Grade",
  type: "string",
  appliesToAllTypes: true,
  placeTypeIds: [],
} as unknown as ScopedCustomFieldDef;

function renderPlace(place: TPlace, defs: ScopedCustomFieldDef[] = []) {
  const noop = vi.fn();
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
      placeCustomFieldDefs={defs}
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
    />,
  );
}

describe("the place page's attribute table", () => {
  // Mutation: drop the `canyonGradeRow` prefix from `attributes`, and a canyon
  // with grades has no Grade row beside its pill.
  it("has one Grade row with the whole grade, not three rows", async () => {
    renderPlace(placeWith({ v_grade: 3, a_grade: 4, commitment: 3 }));
    const term = await screen.findByText("Grade", { selector: "dt" });
    expect(term.nextElementSibling?.textContent).toBe("v3a4III");
    expect(screen.queryByText("V grade")).toBeNull();
    expect(screen.queryByText("Commitment")).toBeNull();
  });

  it("has no Grade row for a place with no grade", async () => {
    renderPlace(placeWith({}));
    await screen.findAllByText("Claustral");
    expect(screen.queryByText("Grade", { selector: "dt" })).toBeNull();
  });

  // Mutation: key the row `grade` again: React sees two rows with one key
  // (it logs it) and a user attribute's row can be dropped or repeated.
  it("keeps a user attribute named Grade as its own row", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPlace(placeWith({ v_grade: 3, grade: "easy" }), [userGrade]);
    const terms = await screen.findAllByText("Grade", { selector: "dt" });
    expect(terms.map((t) => t.nextElementSibling?.textContent)).toEqual([
      "v3",
      "easy",
    ]);
    expect(
      error.mock.calls.some((call) => String(call[0]).includes("same key")),
    ).toBe(false);
    error.mockRestore();
  });
});
