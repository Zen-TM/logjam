import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AccountFailedPanel, { waitsOnAccount } from "./AccountFailedPanel";
import { PanelCloseContext } from "../../../ui/Hero";

afterEach(cleanup);

// A failed account load (the first call after signing in) is why no list ever
// loads: they wait on it. The page says that once, with Try again, instead of
// every list sitting on "Loading…".
describe("the page a failed account load puts in a list's place", () => {
  // Mutation: drop `onClick={onRetry}` from the button, or render nothing
  // when `message` is set, and this goes red.
  it("says the load failed and offers Try again", () => {
    const onRetry = vi.fn();
    render(
      <PanelCloseContext.Provider value={() => {}}>
        <AccountFailedPanel panel="places" onRetry={onRetry} />
      </PanelCloseContext.Provider>,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't load your account.",
    );
    expect(screen.queryByText(/Loading/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  // Mutation: add "account" to the set, and Account (which says its own
  // failure) is replaced by this page too.
  it("replaces the lists that wait on the account, not the pages that do not", () => {
    for (const id of [
      "places",
      "logs",
      "ways",
      "plans",
      "friends",
      "inbox",
    ] as const)
      expect(waitsOnAccount(id)).toBe(true);
    for (const id of ["account", "settings", "place-detail", null] as const)
      expect(waitsOnAccount(id)).toBe(false);
  });
});
