import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, Popover } from "./Menu";

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

describe("a Popover that swallows the press that dismisses it", () => {
  // `map` stands for the element whose presses are swallowed; `other` for a
  // control outside it.
  function open(swallow: boolean) {
    const onClose = vi.fn();
    const heard = vi.fn();
    document.body.addEventListener("click", heard);
    const anchor = document.body.appendChild(document.createElement("div"));
    const map = document.body.appendChild(document.createElement("div"));
    const other = document.body.appendChild(document.createElement("button"));
    render(
      <Popover
        open
        onClose={onClose}
        anchorRef={{ current: anchor }}
        label="Panel"
        dismissOnOutsidePress
        swallowWithin={swallow ? map : null}
      >
        <p>Inside</p>
      </Popover>,
    );
    return {
      onClose,
      heard,
      map,
      other,
      done: () => {
        document.body.removeEventListener("click", heard);
        for (const element of [anchor, map, other]) element.remove();
      },
    };
  }
  const click = (target: Element) => {
    fireEvent.pointerDown(target);
    fireEvent.pointerUp(target);
    fireEvent.click(target);
  };
  afterEach(() => vi.useRealTimers());

  // Mutation: stop passing `swallowWithin` to useOutsidePress, and the click
  // that closes the panel also reaches the map under it.
  it("closes on a press on the map and lets the click that follows nowhere else", () => {
    const { onClose, heard, map, done } = open(true);
    click(map);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard).not.toHaveBeenCalled();
    // Only that one click: the next one is the page's again.
    fireEvent.click(map);
    expect(heard).toHaveBeenCalledTimes(1);
    done();
  });

  // Mutation: swallow every outside press, and a control (a tab, Layers) does
  // nothing on the press that closes the panel.
  it("lets a press on a control outside the map close the panel and still act", () => {
    const { onClose, heard, other, done } = open(true);
    click(other);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    done();
  });

  // Mutation: drop the timer, and a click with no press before it (Enter on a
  // focused button) after a drag that never clicked is eaten.
  it("expires after a press that never clicked, so a later click is not eaten", () => {
    vi.useFakeTimers();
    const { heard, map, done } = open(true);
    fireEvent.pointerDown(map);
    fireEvent.pointerUp(map);
    vi.advanceTimersByTime(500);
    fireEvent.click(document.body);
    expect(heard).toHaveBeenCalledTimes(1);
    done();
  });

  it("does not eat a click after a press that never clicked and a press inside", () => {
    const { heard, map, done } = open(true);
    fireEvent.pointerDown(map);
    // The next press lands inside the panel (the mock keeps it open).
    fireEvent.pointerDown(screen.getByText("Inside"));
    fireEvent.click(document.body);
    expect(heard).toHaveBeenCalledTimes(1);
    done();
  });

  it("leaves the click alone unless asked", () => {
    const { onClose, heard, map, done } = open(false);
    click(map);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    done();
  });

  // Mutation: ignore `onEscape`, and Escape closes the panel from a layer
  // inside it instead of undoing that layer.
  it("hands Escape to the panel's own layers first", () => {
    const onEscape = vi.fn();
    const onClose = vi.fn();
    const anchor = document.body.appendChild(document.createElement("div"));
    render(
      <Popover
        open
        onClose={onClose}
        anchorRef={{ current: anchor }}
        label="Panel"
        onEscape={onEscape}
      >
        <button type="button">Inside</button>
      </Popover>,
    );
    fireEvent.keyDown(screen.getByText("Inside"), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    anchor.remove();
  });
});
