import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfirmCopy } from "@logjam/shared";
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

  describe("with discard", () => {
    const discard: ConfirmCopy = {
      confirmTitle: "Discard this thing?",
      confirmBody: "Nothing you've entered is kept.",
      confirmLabel: "Discard",
      tone: "destructive",
    };
    const open = (onClose: () => void) =>
      render(
        <Dialog
          open
          title="Add a thing"
          onClose={onClose}
          discard={discard}
          footer={(requestClose) => (
            <button type="button" onClick={requestClose}>
              Cancel
            </button>
          )}
        >
          body
        </Dialog>,
      );
    const dialog = () => screen.getAllByRole("dialog", { hidden: true })[0]!;

    // Mutation: call `onClose` directly in `closeIfDismissible`.
    it.each([
      ["Escape", () => fireEvent.keyDown(dialog(), { key: "Escape" })],
      [
        "the close button",
        () => fireEvent.click(screen.getByLabelText("Close")),
      ],
      ["the Cancel button", () => fireEvent.click(screen.getByText("Cancel"))],
    ])("%s asks first and keeps the form on Cancel", (_name, exit) => {
      const onClose = vi.fn();
      open(onClose);
      exit();
      expect(screen.getByText("Discard this thing?")).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();

      const confirmCancel = screen.getAllByText("Cancel").pop()!;
      fireEvent.click(confirmCancel);
      expect(screen.queryByText("Discard this thing?")).toBeNull();
      expect(onClose).not.toHaveBeenCalled();
    });

    it("closes once the verb is chosen", () => {
      const onClose = vi.fn();
      open(onClose);
      fireEvent.click(screen.getByLabelText("Close"));
      fireEvent.click(screen.getByText("Discard"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("closes at once with no discard", () => {
      const onClose = vi.fn();
      render(
        <Dialog open title="Add a thing" onClose={onClose} discard={null}>
          body
        </Dialog>,
      );
      fireEvent.click(screen.getByLabelText("Close"));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
