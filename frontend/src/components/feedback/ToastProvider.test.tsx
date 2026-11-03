import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./ToastProvider";

afterEach(cleanup);

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
    expect(screen.getAllByRole("button", { name: /dismiss/i })).toHaveLength(2);
  });
});
