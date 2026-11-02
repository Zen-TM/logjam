import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShareDialog from "./ShareDialog";

vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

afterEach(cleanup);

describe("ShareDialog for a place", () => {
  // Mutation: drop the `listShares` call in the open effect. Then bob, who has
  // the place, is offered with a "+" instead of listed with a way to stop.
  it("lists who already has it with a way to stop, and offers only the rest", async () => {
    const view = render(
      <ShareDialog
        title="Share Test Canyon"
        kind="place"
        open
        onClose={() => {}}
        friends={[
          { id: "f1", username: "bob", friendshipId: "a" },
          { id: "f2", username: "carol", friendshipId: "b" },
        ]}
        listShares={async () => [
          { id: "s1", sharedWith: { id: "f1", username: "bob" } },
        ]}
        share={async () => {}}
        unshare={async () => {}}
      />,
    );
    const dialog = view.baseElement.querySelector("dialog")!;
    await waitFor(() =>
      expect(
        dialog.querySelector("[aria-label='Stop sharing with bob']"),
      ).not.toBeNull(),
    );
    expect(dialog.textContent).toContain("Share Test Canyon");
    expect(dialog.textContent).toContain("carol");
    expect(dialog.textContent).not.toMatch(/Delete|Export/);
  });
});
