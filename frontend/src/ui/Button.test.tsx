import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

const showPopover = vi.fn();

beforeEach(() => {
  showPopover.mockClear();
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
    hidePopover: vi.fn(),
  });
  const matches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, "matches").mockImplementation(function (
    this: HTMLElement,
    selector: string,
  ) {
    return selector === ":popover-open" ? false : matches.call(this, selector);
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
