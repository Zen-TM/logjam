import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { createRefreshPin } from "./refreshPin";

// The events of a real Android drag: the scroll view takes the touch over and
// JS sees no cancel that matters and no touch end.
describe("createRefreshPin", () => {
  it("leaves a list at its top free to refresh", () => {
    const pin = createRefreshPin();
    pin.scroll(0);
    pin.down();
    expect(pin.held()).toBe(false);
  });

  // Red when the pin is only taken at touch start: Android's refresh layout
  // has taken a touch it was enabled for by then, so the control must already
  // be disabled while the list is scrolled away, before any finger lands.
  it("holds a list off while it is scrolled away, before a finger lands", () => {
    const pin = createRefreshPin();
    pin.scroll(400);
    expect(pin.held()).toBe(true);
  });

  // Red when the release at the top ignores the finger: the drag that began
  // scrolled down reaches the top and arms the refresh.
  it("holds a drag that began scrolled down all the way to the top", () => {
    const pin = createRefreshPin();
    pin.scroll(400);
    pin.down();
    pin.beginDrag();
    pin.scroll(200);
    pin.scroll(0);
    expect(pin.held()).toBe(true);
    pin.endDrag();
    expect(pin.held()).toBe(false);
  });

  // Red when a touch cancel, or a finger-down gate, frees the pin mid-drag:
  // the drag that began at the top, went down the list and came back would arm
  // the refresh.
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

  // Red when a fling that comes to rest at the top leaves the list held: the
  // next touch would land on a disabled control and could never refresh.
  it("frees a list a fling has brought back to the top", () => {
    const pin = createRefreshPin();
    pin.scroll(0);
    pin.down();
    pin.beginDrag();
    pin.scroll(300);
    pin.endDrag();
    expect(pin.held()).toBe(true);
    pin.scroll(100);
    pin.scroll(0);
    expect(pin.held()).toBe(false);
  });

  // Red when `leftTop` forgets the drag: Android's refresh layout armed at
  // the finger landing, so a drag that left the top and came back still asks
  // to refresh and only dropping that request stops it.
  it("remembers that a drag left the top, past the finger lifting", () => {
    const pin = createRefreshPin();
    pin.scroll(0);
    pin.down();
    expect(pin.leftTop()).toBe(false);
    pin.beginDrag();
    pin.scroll(850);
    pin.scroll(0);
    pin.endDrag();
    expect(pin.leftTop()).toBe(true);
    pin.down();
    expect(pin.leftTop()).toBe(false);
  });

  it("does not count a fling's scrolling against the next drag", () => {
    const pin = createRefreshPin();
    pin.scroll(0);
    pin.down();
    pin.beginDrag();
    pin.endDrag();
    pin.scroll(300);
    pin.scroll(0);
    pin.down();
    expect(pin.leftTop()).toBe(false);
  });

  it("keeps a tap on a scrolled list held", () => {
    const pin = createRefreshPin();
    pin.scroll(400);
    pin.down();
    pin.up();
    expect(pin.held()).toBe(true);
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
    pin.scroll(20);
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

// Red when the control hands a pull straight to the screen: the drag that left
// the top would fetch.
it("the control drops a refresh the pin says left the top", () => {
  const text = readFileSync(
    new URL("./refreshFromTop.tsx", import.meta.url),
    "utf8",
  );
  expect(text).toContain("if (!pin.leftTop()) return onRefresh();");
});
