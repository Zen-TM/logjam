import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./ToastProvider";

afterEach(cleanup);

let toastApi: ReturnType<typeof useToast>;
function Grab() {
  toastApi = useToast();
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
      toastApi.error("Couldn't load your account.");
      toastApi.error("Couldn't load your account.");
      toastApi.error("Couldn't load your account.");
    });
    expect(screen.getAllByText("Couldn't load your account.")).toHaveLength(1);
    act(() => toastApi.error("Couldn't load places."));
    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(2);
  });
});
