import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createLayersOpen } from "./layersOpen";

describe("the Layers sheet's open flag", () => {
  it("starts closed, tells subscribers on a change and stays quiet otherwise", () => {
    const open = createLayersOpen();
    const listener = vi.fn();
    open.subscribe(listener);
    expect(open.get()).toBe(false);

    open.set(true);
    expect(open.get()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    open.set(true);
    expect(listener).toHaveBeenCalledTimes(1);

    open.set(false);
    expect(open.get()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops telling a subscriber that has unsubscribed", () => {
    const open = createLayersOpen();
    const listener = vi.fn();
    const unsubscribe = open.subscribe(listener);
    unsubscribe();
    open.set(true);
    expect(listener).not.toHaveBeenCalled();
  });

  // Mutation: have `set` ignore its tab, or keep it after the sheet closes:
  // the Weather bar's title opens the sheet on the wrong tab, or the next
  // plain open lands on Weather.
  it("opens at the tab it is asked for, once per request", () => {
    const open = createLayersOpen();
    const listener = vi.fn();
    open.subscribe(listener);
    expect(open.tab()).toBeNull();

    open.set(true, "weather");
    expect(open.get()).toBe(true);
    expect(open.tab()).toBe("weather");

    open.set(false);
    expect(open.tab()).toBeNull();
    open.set(true);
    expect(open.tab()).toBeNull();
  });

  // Mutation: drop `startTab={startTab}` from the host in MapLayersSheet.tsx,
  // or the sheet's `setTab(startTab)`: the request never reaches the tab.
  it("hands the request from the host to the sheet's tab", () => {
    const sheet = readFileSync(
      new URL("./MapLayersSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(sheet).toContain("useSyncExternalStore(open.subscribe, open.tab)");
    expect(sheet).toContain("startTab={startTab}");
    expect(sheet).toContain("if (startTab) setTab(startTab)");
  });

  // Red when the flag goes back into MapScreen state, where opening the sheet
  // re-renders the whole map. To see it: add `const [pickerOpen, setPickerOpen]
  // = useState(false);` to MapScreen.tsx.
  it("is not MapScreen state", () => {
    const map = readFileSync(
      new URL("./MapScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(map).not.toMatch(/\bpickerOpen\b/);
    expect(map).toContain("createLayersOpen");
  });
});
