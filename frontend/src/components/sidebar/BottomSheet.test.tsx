import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BottomSheet, { nearestStop, stopTranslate } from "./BottomSheet";
import type { SheetSnap } from "./BottomSheet";

const PHONE = { height: 844, short: false };

beforeEach(() => {
  Object.assign(window, { innerWidth: 390, innerHeight: 844 });
  // jsdom has no pointer capture; the handle asks for it on every press.
  Element.prototype.setPointerCapture = vi.fn();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sheet({
  snap = "half",
  closable = true,
}: {
  snap?: SheetSnap;
  closable?: boolean;
} = {}) {
  const onSnapChange = vi.fn();
  const onClose = vi.fn();
  render(
    <BottomSheet
      snap={snap}
      onSnapChange={onSnapChange}
      onClose={closable ? onClose : undefined}
      title="Places"
    >
      <div data-testid="scroller">
        <p data-testid="row">A row</p>
      </div>
    </BottomSheet>,
  );
  return { onSnapChange, onClose };
}

/** A press on the grab bar that moves to `to` over `ms`. */
function dragHandle(to: number, ms: number) {
  const handle = screen.getByRole("slider", { name: "Panel height" });
  fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  fireEvent.pointerMove(handle, { clientY: to, pointerId: 1 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
}

/** A touch that pulls `target` down from y 300 to `to` over `ms`. */
function pull(target: Element, to: number, ms: number) {
  const at = (y: number) => [{ clientX: 100, clientY: y }];
  fireEvent.touchStart(target, { touches: at(300) });
  act(() => {
    vi.advanceTimersByTime(ms);
  });
  const move = fireEvent.touchMove(target, { touches: at(to) });
  fireEvent.touchEnd(target, { touches: [] });
  return move;
}

describe("the sheet's two heights", () => {
  // Mutation: set HALF_REVEAL_FRACTION back to 0.68, which leaves the map the
  // smaller part of the screen behind a page.
  it("opens its lower height a bit under half the screen", () => {
    const shown = (844 - 68 - stopTranslate("half", PHONE, 96)) / PHONE.height;
    expect(shown).toBeGreaterThan(0.3);
    expect(shown).toBeLessThan(0.5);
  });

  // Mutation: put "peek" back in the closable sheet's heights, and Home lands
  // on a strip that shows nothing.
  it("has no peek for a user to reach: the arrow keys run half to full", () => {
    sheet();
    const handle = screen.getByRole("slider", { name: "Panel height" });
    expect(handle.getAttribute("aria-valuemax")).toBe("1");
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
    expect(handle.getAttribute("aria-valuetext")).toBe("Half height");
  });

  it("clamps the keyboard at half instead of closing, and at full", () => {
    const { onSnapChange, onClose } = sheet();
    const handle = screen.getByRole("slider", { name: "Panel height" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onSnapChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: "End" });
    expect(onSnapChange).toHaveBeenCalledWith("full");
  });

  // A map flow or a drawing tool holds the sheet at the peek; there it is the
  // lowest height, and not a place a swipe closes from.
  it("keeps the peek for a sheet that is held there", () => {
    sheet({ snap: "peek" });
    expect(
      screen
        .getByRole("slider", { name: "Panel height" })
        .getAttribute("aria-valuetext"),
    ).toBe("Peek");
  });
});

describe("swiping the grab bar down", () => {
  // Mutation: drop "closed" from the stops, and a swipe snaps back to half.
  it("closes the sheet from half, as its ✕ does", () => {
    const { onSnapChange, onClose } = sheet();
    dragHandle(900, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  it("settles back on half after a short, slow pull", () => {
    const { onSnapChange, onClose } = sheet();
    dragHandle(530, 600);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).toHaveBeenCalledWith("half");
  });

  // Mutation: drop the fling projection in `end`, and a quick flick that stops
  // short of the middle settles on half.
  it("closes on a flick that has not gone far", () => {
    const { onClose } = sheet();
    dragHandle(580, 30);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens to full on a pull up", () => {
    const { onSnapChange, onClose } = sheet();
    dragHandle(100, 400);
    expect(onSnapChange).toHaveBeenCalledWith("full");
    expect(onClose).not.toHaveBeenCalled();
  });

  // A drawing tool's ✕ asks before it discards a line, so SidebarPanel gives
  // it no `onClose`. Mutation: drop the `onClose != null` test from `canClose`.
  it("bottoms out at the peek where the page must ask before it closes", () => {
    const { onSnapChange, onClose } = sheet({ closable: false });
    dragHandle(900, 400);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).toHaveBeenCalledWith("peek");
  });

  it("does not close a sheet held at the peek by a map flow", () => {
    const { onSnapChange, onClose } = sheet({ snap: "peek" });
    dragHandle(900, 400);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).toHaveBeenCalledWith("peek");
  });
});

describe("pulling down anywhere on a page scrolled to its top", () => {
  // Mutation: delete the touch listeners on the content, and only the grab bar
  // drags.
  it("closes the sheet from half", () => {
    const { onClose } = sheet();
    pull(screen.getByTestId("row"), 700, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes the gesture from the browser, so it does not scroll as well", () => {
    sheet();
    expect(pull(screen.getByTestId("row"), 500, 400)).toBe(false);
  });

  // Mutation: ignore `scrollTop` in `scrolledWithin`, and a user scrolling a
  // long list back up closes the page under their finger.
  it("leaves a page that is scrolled down to scroll", () => {
    const { onClose, onSnapChange } = sheet();
    screen.getByTestId("scroller").scrollTop = 120;
    expect(pull(screen.getByTestId("row"), 700, 400)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  it("leaves a push up to scroll", () => {
    const { onClose, onSnapChange } = sheet();
    expect(pull(screen.getByTestId("row"), 100, 400)).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  // Mutation: compare dy to nothing, and a sideways swipe on a chip rail that
  // drifts down a few pixels drags the sheet.
  it("leaves a mostly sideways swipe to the rail under it", () => {
    const { onClose, onSnapChange } = sheet();
    const row = screen.getByTestId("row");
    fireEvent.touchStart(row, { touches: [{ clientX: 100, clientY: 300 }] });
    const move = fireEvent.touchMove(row, {
      touches: [{ clientX: 220, clientY: 320 }],
    });
    fireEvent.touchEnd(row, { touches: [] });
    expect(move).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });
});

describe("nearestStop", () => {
  it("picks the stop whose height is closest", () => {
    const stops = ["full", "half", "closed"] as const;
    const half = stopTranslate("half", PHONE, 96);
    expect(nearestStop(10, stops, PHONE, 96)).toBe("full");
    expect(nearestStop(half + 10, stops, PHONE, 96)).toBe("half");
    expect(nearestStop(10_000, stops, PHONE, 96)).toBe("closed");
  });
});
