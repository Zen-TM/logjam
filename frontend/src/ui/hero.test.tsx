import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hero, PanelCloseContext } from "./Hero";

afterEach(cleanup);

// UX §3: anything that can be closed shows a × at its top right. Every panel's
// hero draws it from the panel's close, so no panel has to remember.
// Mutations that turn these red: stop Hero reading the context; draw the × only
// when `onBack` is absent (a sub-page then has the arrow but no ×).
describe("a panel's hero closes the panel", () => {
  it("draws a Close that does what the rail icon does", () => {
    const close = vi.fn();
    render(
      <PanelCloseContext.Provider value={close}>
        <Hero title="Places" />
      </PanelCloseContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the back arrow and adds the × on a sub-page", () => {
    render(
      <PanelCloseContext.Provider value={() => {}}>
        <Hero
          title="Place types"
          onBack={() => {}}
          backLabel="Back to Settings"
        />
      </PanelCloseContext.Provider>,
    );
    expect(
      screen.getByRole("button", { name: "Back to Settings" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("lets a tool take the × over, and draws none outside a panel", () => {
    const cancel = vi.fn();
    const { rerender } = render(
      <PanelCloseContext.Provider value={() => {}}>
        <Hero title="New route" onClose={cancel} />
      </PanelCloseContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    rerender(<Hero title="Alone" />);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
