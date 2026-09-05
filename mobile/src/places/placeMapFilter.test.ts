import { beforeEach, describe, expect, it } from "vitest";

import {
  getPlaceMapFilter,
  isWithholdingPlaces,
  publishVisiblePlaces,
  resetPlaceMapFilterForTest,
  setPlaceMapFilterEnabled,
  subscribePlaceMapFilter,
} from "./placeMapFilter";

describe("publishVisiblePlaces", () => {
  beforeEach(() => resetPlaceMapFilterForTest());

  it("stores the published set", () => {
    publishVisiblePlaces(["a", "b"], 5);
    expect(getPlaceMapFilter().visibleIds).toEqual(["a", "b"]);
    expect(getPlaceMapFilter().totalCount).toBe(5);
  });

  it("does not notify when the same set is republished", () => {
    // The screen publishes from a render effect, so an unguarded write would
    // re-render the map on every keystroke — and loop through the hook.
    let notifications = 0;
    const unsubscribe = subscribePlaceMapFilter(() => {
      notifications += 1;
    });

    publishVisiblePlaces(["a", "b"], 5);
    expect(notifications).toBe(1);
    publishVisiblePlaces(["a", "b"], 5);
    expect(notifications).toBe(1);

    publishVisiblePlaces(["a"], 5);
    expect(notifications).toBe(2);
    publishVisiblePlaces(["a", "b"], 6); // same ids, new total
    expect(notifications).toBe(3);

    unsubscribe();
    publishVisiblePlaces(["z"], 9);
    expect(notifications).toBe(3);
  });

  it("leaves the enabled flag alone", () => {
    setPlaceMapFilterEnabled(true);
    publishVisiblePlaces(["a"], 2);
    expect(getPlaceMapFilter().enabled).toBe(true);
  });
});

describe("setPlaceMapFilterEnabled", () => {
  beforeEach(() => resetPlaceMapFilterForTest());

  it("only notifies on a real change", () => {
    let notifications = 0;
    const unsubscribe = subscribePlaceMapFilter(() => {
      notifications += 1;
    });
    setPlaceMapFilterEnabled(true);
    setPlaceMapFilterEnabled(true);
    expect(notifications).toBe(1);
    setPlaceMapFilterEnabled(false);
    expect(notifications).toBe(2);
    unsubscribe();
  });
});

describe("isWithholdingPlaces", () => {
  it("is false until the screen has published, even when enabled", () => {
    // A fresh launch must not accuse the map of hiding anything.
    expect(
      isWithholdingPlaces({ enabled: true, visibleIds: null, totalCount: 30 }),
    ).toBe(false);
  });

  it("is true only when the filtered set is smaller than the whole", () => {
    expect(
      isWithholdingPlaces({ enabled: true, visibleIds: ["a"], totalCount: 3 }),
    ).toBe(true);
    expect(
      isWithholdingPlaces({
        enabled: true,
        visibleIds: ["a", "b", "c"],
        totalCount: 3,
      }),
    ).toBe(false);
  });

  it("is false while the option is off, whatever is published", () => {
    expect(
      isWithholdingPlaces({ enabled: false, visibleIds: [], totalCount: 3 }),
    ).toBe(false);
  });
});
