import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscape } from "./useEscape";

afterEach(cleanup);

function Layer({ onEscape }: { onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(ref, onEscape);
  return (
    <div ref={ref}>
      <button>inside</button>
      <div role="menu">
        <button role="menuitem">verb</button>
      </div>
    </div>
  );
}

describe("useEscape", () => {
  it("handles Escape from the layer", () => {
    const onEscape = vi.fn();
    render(<Layer onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByText("inside"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
  });

  // Mutation: drop the `[role="menu"]` check and Escape in a row's open menu
  // closes the Layers popover holding it, not just the menu.
  it("leaves Escape inside an open menu to the menu", () => {
    const onEscape = vi.fn();
    render(<Layer onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByRole("menuitem"), { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });

  // Mutation: prevent and stop the key before asking the handler, and a layer
  // with nothing to undo (a root page) still swallows Escape.
  it("lets a declined press through", () => {
    const outside = vi.fn();
    document.addEventListener("keydown", outside);
    render(<Layer onEscape={() => false} />);
    fireEvent.keyDown(screen.getByText("inside"), { key: "Escape" });
    document.removeEventListener("keydown", outside);
    expect(outside).toHaveBeenCalledOnce();
    expect(outside.mock.calls[0][0].defaultPrevented).toBe(false);
  });
});
