import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu, Popover, takeDismissingPress, useOutsidePress } from "./Menu";

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

describe("useOutsidePress with suppressAskWithin", () => {
  function Host({
    onOutside,
    within,
  }: {
    onOutside: () => void;
    within: Element;
  }) {
    const ref = useRef<HTMLDivElement>(null);
    useOutsidePress(true, [ref], onOutside, within);
    return <div ref={ref}>inside</div>;
  }

  // Mutation: stop marking presses inside `within`, and the map reads the
  // click that closed the tray as a new question; mark every press, and a tab
  // that closes it is taken for a map click.
  it("marks a press on the map, and the click still reaches the map", () => {
    const map = document.body.appendChild(document.createElement("div"));
    const onMapClick = vi.fn();
    map.addEventListener("click", onMapClick);
    const onOutside = vi.fn();
    render(<Host onOutside={onOutside} within={map} />);
    fireEvent.pointerDown(map);
    fireEvent.click(map);
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onMapClick).toHaveBeenCalledTimes(1);
    expect(takeDismissingPress()).toBe(true);
    map.remove();
  });

  it("closes on a press elsewhere and lets that control act", () => {
    const map = document.body.appendChild(document.createElement("div"));
    const tab = document.body.appendChild(document.createElement("button"));
    const onTab = vi.fn();
    tab.addEventListener("click", onTab);
    const onOutside = vi.fn();
    render(<Host onOutside={onOutside} within={map} />);
    fireEvent.pointerDown(tab);
    fireEvent.click(tab);
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onTab).toHaveBeenCalledTimes(1);
    map.remove();
    tab.remove();
  });
});

describe("a Popover that marks the press that dismisses it", () => {
  // `map` stands for the element whose presses are marked; `other` for a
  // control outside it.
  function open(mark: boolean) {
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
        suppressAskWithin={mark ? map : null}
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
        // Clear a mark a test left behind.
        takeDismissingPress();
      },
    };
  }
  const click = (target: Element) => {
    fireEvent.pointerDown(target);
    fireEvent.pointerUp(target);
    fireEvent.click(target);
  };
  afterEach(() => vi.useRealTimers());

  // Mutation: stop passing `suppressAskWithin` to useOutsidePress, and the
  // click that closes the panel also asks the map about a new point.
  it("closes on a press on the map and marks that click once, for the map to read", () => {
    const { onClose, map, done } = open(true);
    click(map);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(takeDismissingPress()).toBe(true);
    // Only that one click: the next one is the map's again.
    expect(takeDismissingPress()).toBe(false);
    done();
  });

  // Mutation: stop the click (stopPropagation) as well, and a route, place or
  // gauge under the press no longer acts on it.
  it("never stops the click, so what is under the press still acts", () => {
    const { heard, map, done } = open(true);
    click(map);
    expect(heard).toHaveBeenCalledTimes(1);
    done();
  });

  // Mutation: mark every outside press, and a press on a control closes the
  // panel but the next map click is dropped.
  it("does not mark a press on a control outside the map", () => {
    const { onClose, heard, other, done } = open(true);
    click(other);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(takeDismissingPress()).toBe(false);
    done();
  });

  // Mutation: drop the timer, and a click with no press before it (Enter on a
  // focused button) after a drag that never clicked is taken for the press.
  it("expires after a press that never clicked, so a later click is not taken", () => {
    vi.useFakeTimers();
    const { map, done } = open(true);
    fireEvent.pointerDown(map);
    fireEvent.pointerUp(map);
    vi.advanceTimersByTime(500);
    expect(takeDismissingPress()).toBe(false);
    done();
  });

  it("forgets the mark when the next press lands", () => {
    const { map, done } = open(true);
    fireEvent.pointerDown(map);
    // The next press lands inside the panel (the mock keeps it open).
    fireEvent.pointerDown(screen.getByText("Inside"));
    expect(takeDismissingPress()).toBe(false);
    done();
  });

  it("marks nothing unless asked", () => {
    const { onClose, map, done } = open(false);
    click(map);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(takeDismissingPress()).toBe(false);
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
