import { beforeEach, describe, expect, it } from "vitest";

import {
  getCanyonMapFilter,
  isWithholdingCanyons,
  publishVisibleCanyons,
  resetCanyonMapFilterForTest,
  setCanyonMapFilterEnabled,
  subscribeCanyonMapFilter,
} from "./canyonMapFilter";

describe("publishVisibleCanyons", () => {
  beforeEach(() => resetCanyonMapFilterForTest());

  it("stores the published set", () => {
    publishVisibleCanyons(["a", "b"], 5);
    expect(getCanyonMapFilter().visibleIds).toEqual(["a", "b"]);
    expect(getCanyonMapFilter().totalCount).toBe(5);
  });

  it("does not notify when the same set is republished", () => {
    // The screen publishes from a render effect, so an unguarded write would
    // re-render the map on every keystroke — and loop through the hook.
    let notifications = 0;
    const unsubscribe = subscribeCanyonMapFilter(() => {
      notifications += 1;
    });

    publishVisibleCanyons(["a", "b"], 5);
    expect(notifications).toBe(1);
    publishVisibleCanyons(["a", "b"], 5);
    expect(notifications).toBe(1);

    publishVisibleCanyons(["a"], 5);
    expect(notifications).toBe(2);
    publishVisibleCanyons(["a", "b"], 6); // same ids, new total
    expect(notifications).toBe(3);

    unsubscribe();
    publishVisibleCanyons(["z"], 9);
    expect(notifications).toBe(3);
  });

  it("leaves the enabled flag alone", () => {
    setCanyonMapFilterEnabled(true);
    publishVisibleCanyons(["a"], 2);
    expect(getCanyonMapFilter().enabled).toBe(true);
  });
});

describe("setCanyonMapFilterEnabled", () => {
  beforeEach(() => resetCanyonMapFilterForTest());

  it("only notifies on a real change", () => {
    let notifications = 0;
    const unsubscribe = subscribeCanyonMapFilter(() => {
      notifications += 1;
    });
    setCanyonMapFilterEnabled(true);
    setCanyonMapFilterEnabled(true);
    expect(notifications).toBe(1);
    setCanyonMapFilterEnabled(false);
    expect(notifications).toBe(2);
    unsubscribe();
  });
});

describe("isWithholdingCanyons", () => {
  it("is false until the screen has published, even when enabled", () => {
    // A fresh launch must not accuse the map of hiding anything.
    expect(
      isWithholdingCanyons({ enabled: true, visibleIds: null, totalCount: 30 }),
    ).toBe(false);
  });

  it("is true only when the filtered set is smaller than the whole", () => {
    expect(
      isWithholdingCanyons({ enabled: true, visibleIds: ["a"], totalCount: 3 }),
    ).toBe(true);
    expect(
      isWithholdingCanyons({
        enabled: true,
        visibleIds: ["a", "b", "c"],
        totalCount: 3,
      }),
    ).toBe(false);
  });

  it("is false while the option is off, whatever is published", () => {
    expect(
      isWithholdingCanyons({ enabled: false, visibleIds: [], totalCount: 3 }),
    ).toBe(false);
  });
});
