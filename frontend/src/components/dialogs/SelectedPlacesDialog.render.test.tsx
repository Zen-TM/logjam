import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sharePromise } from "@logjam/shared";
import type { TFriend, TPlace } from "../../placeUtils";
import SelectedPlacesDialog from "./SelectedPlacesDialog";

const bulkSharePlaces = vi.fn();
vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  bulkSharePlaces: (...args: unknown[]) => bulkSharePlaces(...args),
}));
vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ done: vi.fn(), error: vi.fn() }),
}));

HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

beforeEach(() => {
  bulkSharePlaces.mockReset();
});
afterEach(cleanup);

const place = {
  id: "p1",
  name: "Test Canyon",
  altNames: [],
} as unknown as TPlace;
const friends: TFriend[] = [{ id: "f1", username: "bob", friendshipId: "fs1" }];

function open(mode: "share" | "export", onClose = vi.fn()) {
  const view = render(
    <SelectedPlacesDialog
      open
      mode={mode}
      selectedPlaces={[place]}
      placeCustomFieldDefs={[]}
      availablePlaces={[place]}
      ownedPlaceIds={new Set(["p1"])}
      friends={friends}
      onClose={onClose}
      onRemovePlace={() => {}}
      onAddPlace={() => {}}
    />,
  );
  return { dialog: view.baseElement.querySelector("dialog")!, onClose };
}

describe("SelectedPlacesDialog", () => {
  // Mutation: put the hand-typed "while the share is active" sentence back, or
  // the Delete button.
  it("shares with the contract's promise, no Delete, and nothing to warn about before a pick", () => {
    const { dialog } = open("share");
    expect(dialog.textContent).toContain("Share 1 place");
    expect(dialog.textContent).toContain(sharePromise("selection"));
    expect(dialog.textContent).not.toMatch(/Delete|Export|while the share/);
    expect(dialog.querySelector("[role=alert]")).toBeNull();
    const send = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Share",
    )!;
    expect(send.getAttribute("aria-disabled")).toBe("true");
  });

  // Mutation: count a 409 / alreadyShared as a failure (setShareError).
  it("treats a place that is already shared as done, not as an error", async () => {
    bulkSharePlaces.mockResolvedValue({
      granted: 0,
      alreadyShared: 1,
      ineligible: 0,
    });
    const { dialog, onClose } = open("share");
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("bob"),
      )!,
    );
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === "Share with 1 friend",
      )!,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(bulkSharePlaces).toHaveBeenCalledWith(["p1"], ["f1"]);
    expect(dialog.querySelector("[role=alert]")).toBeNull();
  });

  // Mutation: call onClose in the catch.
  it("keeps the dialog open with the error when the request fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    bulkSharePlaces.mockImplementation(async () => {
      throw new Error("boom");
    });
    const { dialog, onClose } = open("share");
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("bob"),
      )!,
    );
    fireEvent.click(
      [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === "Share with 1 friend",
      )!,
    );
    await waitFor(() =>
      expect(dialog.querySelector("[role=alert]")).not.toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("export mode offers the file and not the friends", () => {
    const { dialog } = open("export");
    expect(dialog.textContent).toContain("Export 1 place");
    expect(dialog.textContent).toContain("Download");
    expect(dialog.textContent).not.toMatch(/bob|Delete/);
  });
});
