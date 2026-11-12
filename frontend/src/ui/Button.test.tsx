import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

let shown = false;
const showPopover = vi.fn(() => {
  shown = true;
});
const hidePopover = vi.fn(() => {
  shown = false;
});

beforeEach(() => {
  shown = false;
  showPopover.mockClear();
  hidePopover.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom has no popover API; the tooltip only needs to be asked to open.
  Object.assign(HTMLElement.prototype, {
    showPopover,
    hidePopover,
  });
  const matches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
    this: HTMLElement,
    selector: string,
  ) {
    return selector === ":popover-open" ? shown : matches.call(this, selector);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Button with a disabledReason", () => {
  // Mutation: drop `openOnPress` from the `Tooltip` in `Button`, and a touch
  // screen, which never hovers, is never told why.
  it("opens its reason on a press, and does nothing else", () => {
    const onClick = vi.fn();
    render(
      <Button disabled disabledReason="Needs a connection" onClick={onClick}>
        Send
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(showPopover).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe(
      "Needs a connection",
    );
  });
});

describe("a tooltip opened by a press", () => {
  // Mutation: drop the `(hover: none)` check in `Tooltip`'s `press`, and a
  // mouse still resting on the button loses its reason after 4 s (WCAG 1.4.13).
  it("stays open under a mouse until the pointer leaves", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(
      <Button disabled disabledReason="Needs a connection">
        Send
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => vi.advanceTimersByTime(10_000));
    expect(hidePopover).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
