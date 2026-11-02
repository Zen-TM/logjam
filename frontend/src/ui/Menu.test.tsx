import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu";

// jsdom has no Popover API, and a closed `popover` counts as unrendered
// there, so showing one drops the attribute.
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
});
// Nor layout: the menu measures its anchor.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

describe("a menu item offered but not yet runnable", () => {
  // Mutation: render it natively `disabled`, and the arrow keys skip it, so
  // its reason is never heard.
  it("is reached by the arrow keys, says why in its name, and does nothing", () => {
    const later = vi.fn();
    render(
      <Menu
        label="Plan actions"
        entries={[
          { id: "edit", label: "Edit", onSelect: () => {} },
          {
            id: "log",
            label: "Start a trip log",
            onSelect: later,
            disabledReason: "After the trip",
          },
        ]}
        trigger={(props) => (
          <button type="button" {...props}>
            Actions
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    const item = screen.getByRole("menuitem", {
      name: "Start a trip log, After the trip",
    });
    expect(document.activeElement).toBe(item);
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(later).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

describe("a press outside a floating element", () => {
  function open() {
    render(
      <Menu
        label="Actions"
        entries={[{ id: "a", label: "A", onSelect: () => {} }]}
        trigger={(props) => (
          <button type="button" {...props}>
            Actions
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  }

  // Mutation: drop the `dialog[open]` check in useOutsidePress, and a help
  // Dialog opened from inside a popover closes it on the first press.
  it("is not one when it lands in an open modal dialog portaled out of it", () => {
    open();
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");
    const inner = dialog.appendChild(document.createElement("button"));
    fireEvent.pointerDown(inner);
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    dialog.remove();
    fireEvent.pointerDown(document.body);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
