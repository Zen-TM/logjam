import { cleanup, render } from "@testing-library/react";
import { deleteAccountPhrase } from "@logjam/shared";
import { afterEach, describe, expect, it } from "vitest";
import DeleteAccountDialog from "./DeleteAccountDialog";

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

afterEach(cleanup);

describe("DeleteAccountDialog", () => {
  // A placeholder equal to the phrase reads as already typed. Mutation that
  // turns it red: put placeholder={deleteAccountPhrase(username)} back.
  it("does not pre-fill the phrase as a placeholder", () => {
    const { baseElement } = render(
      <DeleteAccountDialog
        open
        username="alice"
        onClose={() => {}}
        onDeleted={() => {}}
      />,
    );
    const input = baseElement.querySelector("input")!;
    expect(input.getAttribute("placeholder") ?? "").not.toBe(
      deleteAccountPhrase("alice"),
    );
  });
});
