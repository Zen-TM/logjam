import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

afterEach(cleanup);

describe("Dialog", () => {
  // Mutation: drop `event.stopPropagation()` from its Escape handler.
  it("closes on Escape without the key reaching the page behind it", () => {
    const onClose = vi.fn();
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    render(
      <Dialog open title="Delete file?" onClose={onClose}>
        body
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    document.removeEventListener("keydown", behind);

    expect(onClose).toHaveBeenCalledOnce();
    expect(behind).not.toHaveBeenCalled();
  });
});
