import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRefreshPin, refreshPinAfter } from "./refreshPin";

describe("refreshPinAfter", () => {
  // Red when `down` holds a list at its top off.
  it("leaves a drag that began at the top free to refresh", () => {
    expect(refreshPinAfter("down", { pinned: false, scrolled: 0 })).toBe(false);
  });

  // Red when `down` stops reading the offset: a drag that starts scrolled down
  // and reaches the top would arm the refresh.
  it("holds off a drag that began scrolled down", () => {
    expect(refreshPinAfter("down", { pinned: false, scrolled: 400 })).toBe(
      true,
    );
  });

  // Red when `scroll` stops pinning: a drag that began at the top, went down
  // the list and came back would arm the refresh.
  it("holds off a drag that leaves the top", () => {
    expect(refreshPinAfter("scroll", { pinned: false, scrolled: 20 })).toBe(
      true,
    );
  });

  // Red when `scroll` unpins on reaching the top: the drag that scrolled down
  // reaches the top again and arms the refresh.
  it("stays held off when the same drag returns to the top", () => {
    expect(refreshPinAfter("scroll", { pinned: true, scrolled: 0 })).toBe(true);
  });

  it("frees the list when the finger lifts", () => {
    expect(refreshPinAfter("up", { pinned: true, scrolled: 400 })).toBe(false);
  });
});

// The events of a real Android drag: the scroll view takes the touch over and
// JS sees no cancel that matters and no touch end.
describe("createRefreshPin", () => {
  // Red when the pin is released by a touch cancel, or `scroll` is gated on
  // the finger being down rather than on a drag: the drag that began at the
  // top and came back would arm the refresh.
  it("holds off a drag that began at the top, left it and came back", () => {
    const pin = createRefreshPin();
    pin.scroll(0);
    pin.down();
    // (the touch cancel the scroll view's drag start sends is not wired)
    pin.beginDrag();
    pin.scroll(30);
    pin.scroll(0);
    expect(pin.held()).toBe(true);
    pin.endDrag();
    expect(pin.held()).toBe(false);
  });

  // Red when the drag start frees the pin (a cancel treated as a lift): the
  // drag that began scrolled down would arm the refresh on reaching the top.
  it("holds a drag that began scrolled down all the way to the top", () => {
    const pin = createRefreshPin();
    pin.scroll(400);
    pin.down();
    pin.beginDrag();
    pin.scroll(200);
    pin.scroll(0);
    expect(pin.held()).toBe(true);
  });

  // Red when `scroll` pins without a drag: a fling after the finger lifted
  // would leave the next touch's native down ignored by a disabled control.
  it("is not pinned by momentum after the finger lifts", () => {
    const pin = createRefreshPin();
    pin.scroll(0);
    pin.down();
    pin.beginDrag();
    pin.endDrag();
    pin.scroll(300);
    expect(pin.held()).toBe(false);
  });

  it("frees a tap on a scrolled list when the finger lifts", () => {
    const pin = createRefreshPin();
    pin.scroll(400);
    pin.down();
    expect(pin.held()).toBe(true);
    pin.up();
    expect(pin.held()).toBe(false);
  });

  it("tells a subscriber only when the pin changes", () => {
    const pin = createRefreshPin();
    let calls = 0;
    pin.subscribe(() => calls++);
    pin.scroll(0);
    pin.down();
    pin.up();
    expect(calls).toBe(0);
    pin.scroll(10);
    pin.down();
    expect(calls).toBe(1);
  });
});

// Red when a screen draws a bare `<RefreshControl>` (or one of two in a file
// goes back to it): its pull then arms from a drag that started scrolled down.
it("every list refresh is drawn by its <pull.Refresh>", () => {
  const src = new URL("../", import.meta.url);
  const files = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx$/.test(file) && !file.includes(".test."))
    .map((file) => ({ file, text: readFileSync(new URL(file, src), "utf8") }));
  const count = (text: string, needle: string) => text.split(needle).length - 1;
  const offenders = files
    .filter(({ file }) => file !== "ui/refreshFromTop.tsx")
    .filter(({ text }) => {
      const controls = count(text, "<pull.Refresh");
      return (
        text.includes("<RefreshControl") ||
        controls !== count(text, "{...pull.scrollProps}")
      );
    })
    .map(({ file }) => file);
  expect(offenders).toEqual([]);
});
