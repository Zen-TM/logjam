import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./ToastProvider";

// jsdom has no Popover API, so the calls are recorded on the prototype.
const calls: string[] = [];
HTMLElement.prototype.showPopover = () => void calls.push("show");
HTMLElement.prototype.hidePopover = () => void calls.push("hide");

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe("the toast stack joins the top layer", () => {
  // Mutation: drop `popover="manual"` / the showPopover() call, and a toast
  // raised while a modal Dialog is open paints under it, where no z-index helps.
  // Re-showing after each change is what lifts it above a Dialog opened later.
  it("is a manual popover, shown again for each toast and hidden when empty", () => {
    let toast!: ReturnType<typeof useToast>;
    const Grab = () => {
      toast = useToast();
      return null;
    };
    vi.useFakeTimers();
    const { container } = render(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    expect(container.querySelector("[popover=manual]")).not.toBeNull();
    calls.length = 0;
    act(() => toast.error("Could not share."));
    expect(screen.getByText("Could not share.")).toBeTruthy();
    expect(calls).toEqual(["hide", "show"]);
    calls.length = 0;
    act(() => toast.done("Saved."));
    expect(calls).toEqual(["hide", "show"]);
    calls.length = 0;
    act(() => void vi.advanceTimersByTime(60_000));
    expect(calls[calls.length - 1]).toBe("hide");
    vi.useRealTimers();
  });
});

function Buttons() {
  const toast = useToast();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          toast.error("Couldn't load your account.");
          toast.error("Couldn't load your account.");
          toast.error("Couldn't load your account.");
        }}
      >
        same
      </button>
      <button
        type="button"
        onClick={() => toast.error("Couldn't load places.")}
      >
        other
      </button>
    </>
  );
}

describe("toasts", () => {
  // Mutation: remove the same-message check in `push`, and three failed loads
  // stack three identical toasts.
  it("shows one toast for the same message said again while it is up", () => {
    render(
      <ToastProvider>
        <Buttons />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("same"));
    expect(screen.getAllByText("Couldn't load your account.")).toHaveLength(1);
    fireEvent.click(screen.getByText("other"));
    expect(
      // The stack is a closed popover in jsdom, which has no Popover API.
      screen.getAllByRole("button", { name: /dismiss/i, hidden: true }),
    ).toHaveLength(2);
  });
});
