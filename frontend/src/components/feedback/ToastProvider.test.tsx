import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./ToastProvider";

afterEach(cleanup);

const grabbed: { toast?: ReturnType<typeof useToast> } = {};
function Grab() {
  grabbed.toast = useToast();
  return null;
}

describe("toasts", () => {
  // Mutation: remove the same-message check in `push`, and three failed loads
  // stack three identical toasts.
  it("shows one toast for the same message said again while it is up", () => {
    render(
      <ToastProvider>
        <Grab />
      </ToastProvider>,
    );
    act(() => {
      grabbed.toast!.error("Couldn't load your account.");
      grabbed.toast!.error("Couldn't load your account.");
      grabbed.toast!.error("Couldn't load your account.");
    });
    expect(screen.getAllByText("Couldn't load your account.")).toHaveLength(1);
    act(() => grabbed.toast!.error("Couldn't load places."));
    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(2);
  });
});
