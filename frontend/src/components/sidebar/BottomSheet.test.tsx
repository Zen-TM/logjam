import { readFileSync } from "node:fs";
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
  peek = false,
}: {
  snap?: SheetSnap;
  closable?: boolean;
  peek?: boolean;
} = {}) {
  const onSnapChange = vi.fn();
  const onClose = vi.fn();
  render(
    <BottomSheet
      snap={snap}
      onSnapChange={onSnapChange}
      onClose={closable ? onClose : undefined}
      peek={peek}
      title="Places"
    >
      <div data-testid="scroller">
        <div data-testid="inner">
          <p data-testid="row">A row</p>
        </div>
        <input data-testid="field" />
        <div data-no-sheet-drag>
          <p data-testid="marked">A scrub chart</p>
        </div>
        <div style={{ touchAction: "none" }}>
          <p data-testid="scrub">A chart that owns its touches</p>
        </div>
        <button
          data-testid="eats"
          onKeyDown={(event) => event.preventDefault()}
        />
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
    sheet({ snap: "peek", peek: true, closable: false });
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

  // A route tool's ✕ asks before it discards a line, so SidebarPanel gives it no
  // `onClose`. Mutation: add "closed" to the stops whatever `onClose` is.
  it("bottoms out at the peek where the page must ask before it closes", () => {
    const { onSnapChange, onClose } = sheet({ closable: false, peek: true });
    dragHandle(900, 400);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).toHaveBeenCalledWith("peek");
  });

  // A map flow brings the sheet down and gives it no `onClose` until the flow
  // ends, so lifting it to half and back never leaves a way to close it.
  // Mutation: derive "no peek" from the snap (`snap !== "peek"`).
  it("keeps the peek as the floor of a sheet a map flow lifted to half", () => {
    const { onSnapChange, onClose } = sheet({
      snap: "half",
      closable: false,
      peek: true,
    });
    expect(
      screen
        .getByRole("slider", { name: "Panel height" })
        .getAttribute("aria-valuemax"),
    ).toBe("2");
    dragHandle(900, 400);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).toHaveBeenCalledWith("peek");
  });

  // Measure keeps nothing, so its ✕ asks nothing and a swipe may close it, from
  // the peek it opens at.
  it("closes a tool that asks nothing, from its peek", () => {
    const { onClose } = sheet({ snap: "peek", peek: true });
    dragHandle(900, 400);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Mutation: make `onPointerCancel` call `end`, and a call that interrupts a
  // low drag closes the page.
  it("goes back where it was when the press is cancelled", () => {
    const { onSnapChange, onClose } = sheet();
    const handle = screen.getByRole("slider", { name: "Panel height" });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 900, pointerId: 1 });
    fireEvent.pointerCancel(handle, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  // Mutation: drop the age test in `end`, and fling, hold still, then lift
  // closes where the finger stopped.
  it("does not fling on a finger that stopped before it lifted", () => {
    const { onSnapChange, onClose } = sheet();
    const handle = screen.getByRole("slider", { name: "Panel height" });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(30);
    });
    fireEvent.pointerMove(handle, { clientY: 580, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).toHaveBeenCalledWith("half");
  });
});

describe("Escape", () => {
  // Mutation: drop the `onClose` call from `handleEscape`.
  it("closes a sheet that can close", () => {
    const { onClose } = sheet();
    fireEvent.keyDown(screen.getByTestId("row"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Mutation: drop the `defaultPrevented` test, and an Escape a row selection
  // or a search already took closes the page as well.
  it("leaves an Escape something inside already took", () => {
    const { onClose } = sheet();
    fireEvent.keyDown(screen.getByTestId("eats"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves an Escape in a field to the field", () => {
    const { onClose } = sheet();
    fireEvent.keyDown(screen.getByTestId("field"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does nothing on a sheet that cannot close", () => {
    const { onClose } = sheet({ closable: false, peek: true });
    fireEvent.keyDown(screen.getByTestId("row"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
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

describe("a touch that is not a pull", () => {
  const at = (y: number, x = 100) => ({
    touches: [{ clientX: x, clientY: y }],
  });

  // Mutation: read `blocked` once at touchstart (drop the latch in `onMove`),
  // and a list pushed up then pulled back past its start drags the sheet while
  // the browser is still scrolling it.
  it("stays the page's once it has gone up, however far it comes back down", () => {
    const { onClose, onSnapChange } = sheet();
    const row = screen.getByTestId("row");
    fireEvent.touchStart(row, at(300));
    fireEvent.touchMove(row, at(200));
    const back = fireEvent.touchMove(row, at(450));
    fireEvent.touchEnd(row, { touches: [] });
    expect(back).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  // Mutation: remove the `scrolledWithin` test from `onMove`, and a list that
  // scrolled during the gesture is pulled as well.
  it("stays the page's once the page has scrolled under it", () => {
    const { onClose } = sheet();
    const row = screen.getByTestId("row");
    fireEvent.touchStart(row, at(300));
    screen.getByTestId("scroller").scrollTop = 40;
    const move = fireEvent.touchMove(row, at(450));
    fireEvent.touchEnd(row, { touches: [] });
    expect(move).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  // Mutation: stop the ancestor walk after one level.
  it("sees a scroller more than one level above the touch", () => {
    const { onClose } = sheet();
    screen.getByTestId("scroller").scrollTop = 120;
    pull(screen.getByTestId("row"), 700, 400);
    expect(onClose).not.toHaveBeenCalled();
  });

  // Mutation: drop `ownsTouch` from `onStart`.
  it.each(["field", "marked", "scrub"])(
    "leaves a drag on %s to it",
    (testId) => {
      const { onClose, onSnapChange } = sheet();
      expect(pull(screen.getByTestId(testId), 700, 400)).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      expect(onSnapChange).not.toHaveBeenCalled();
    },
  );

  // Mutation: do not call `cancel` when a second finger lands, and the sheet is
  // left mid-height with its transition off.
  it("puts the sheet back when a second finger lands mid-drag", () => {
    const { onClose, onSnapChange } = sheet();
    const aside = screen.getByRole("complementary");
    const rest = aside.style.transform;
    const row = screen.getByTestId("row");
    fireEvent.touchStart(row, at(300));
    fireEvent.touchMove(row, at(500));
    expect(aside.style.transform).not.toBe(rest);
    fireEvent.touchStart(row, {
      touches: [
        { clientX: 100, clientY: 500 },
        { clientX: 200, clientY: 520 },
      ],
    });
    expect(aside.style.transform).toBe(rest);
    fireEvent.touchEnd(row, { touches: [] });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });

  // Mutation: point `touchcancel` at `onEnd`.
  it("puts the sheet back, and does not close it, when the OS cancels", () => {
    const { onClose, onSnapChange } = sheet();
    const row = screen.getByTestId("row");
    fireEvent.touchStart(row, at(300));
    fireEvent.touchMove(row, at(750));
    fireEvent.touchCancel(row, { touches: [] });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSnapChange).not.toHaveBeenCalled();
  });
});

// Mutation: delete either rule. A pull down that overshoots the top of a page
// would then reach the document and refresh Logjam Web, losing an open form.
describe("overscroll containment", () => {
  const css = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  it("contains the scroll chain in the sheet and stops it at the page", () => {
    expect(css("./BottomSheet.module.css")).toMatch(
      /\.content \*\s*\{[^}]*overscroll-behavior-y:\s*contain/,
    );
    expect(css("../../index.css")).toMatch(
      /html,\s*body\s*\{[^}]*overscroll-behavior-y:\s*none/,
    );
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
