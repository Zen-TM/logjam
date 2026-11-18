import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PLACE_FILTERS,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPE_IDS,
  type CanyonGradeSystem,
  type PlaceFilters,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import PlaceFilterSheet from "./PlaceFilterSheet";

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

afterEach(cleanup);

const DEFS = SYSTEM_FIELD_DEFS.map((def) => ({
  ...def,
  ownerId: null,
  appliesToAllTypes: false,
  placeTypeIds: def.placeTypes.map((key) => SYSTEM_PLACE_TYPE_IDS[key]),
  tripTypes: [],
})) as unknown as ScopedCustomFieldDef[];

function sheet(
  gradeSystem: CanyonGradeSystem,
  listedPlaces: { fieldValues?: unknown }[] = [],
  filters: PlaceFilters = EMPTY_PLACE_FILTERS,
) {
  const noop = vi.fn();
  return (
    <PlaceFilterSheet
      filters={filters}
      onChangeFilters={noop}
      status="all"
      onChangeStatus={noop}
      sort="name"
      onChangeSort={noop}
      placeCustomFieldDefs={DEFS}
      gradeSystem={gradeSystem}
      listedPlaces={listedPlaces}
      onDrawArea={noop}
      onAreaToView={noop}
      onReset={noop}
      onClose={noop}
      activeCount={0}
      resultCount={0}
    />
  );
}

const has = (label: string) => screen.queryByText(label) !== null;

describe("PlaceFilterSheet, a canyon's grade axes", () => {
  // Mutation: build `fieldDefs` in PlaceFilterSheet as `placeCustomFieldDefs`
  // itself: the four ACA axes show over NSW.
  it("are the French ones where the map grades in French, whatever the places hold", () => {
    render(sheet("french", [{ fieldValues: { v_grade: 3 } }]));
    expect(has("V grade")).toBe(true);
    expect(has("Commitment")).toBe(true);
    expect(has("ACA water")).toBe(false);
  });

  // Mutation: drop the `places.some(...)` clause in `placeFilterDefs`.
  it("gain the axis of one ACA value a listed place holds", () => {
    render(sheet("french", [{ fieldValues: { aca_water: 5 } }, {}]));
    expect(has("ACA water")).toBe(true);
    expect(has("ACA risk")).toBe(false);
    expect(has("V grade")).toBe(true);
  });

  // Mutation: ignore `gradeSystem` in `placeFilterDefs`.
  it("are the ACA ones where the map grades in ACA", () => {
    render(sheet("aca"));
    expect(has("ACA water")).toBe(true);
    expect(has("ACA technical")).toBe(true);
    expect(has("V grade")).toBe(false);
  });

  // Mutation: drop the `def.key in custom` clause in `placeFilterDefs`: the
  // row a user is filtering on vanishes when the map pans.
  it("keep the axis an active filter is set on", () => {
    render(
      sheet("french", [], {
        ...EMPTY_PLACE_FILTERS,
        custom: { aca_water: { kind: "numberRange", range: [2, 4] } },
      }),
    );
    expect(has("ACA water")).toBe(true);
    expect(has("ACA time")).toBe(false);
  });
});
