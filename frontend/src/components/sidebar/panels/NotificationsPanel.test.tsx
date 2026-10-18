import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TNotification } from "../../../placeUtils";
import { ToastProvider } from "../../feedback/ToastProvider";
import NotificationsPanel from "./NotificationsPanel";

const api = vi.hoisted(() => ({
  markNotificationRead: vi.fn(async () => {}),
}));
vi.mock("../../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../placeUtils")>()),
  ...api,
}));

// jsdom has no ResizeObserver, scrollIntoView or modal <dialog>.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const announcement: TNotification = {
  id: "n1",
  type: "announcement",
  payload: {
    announcementId: "a1",
    title: "Track sharing is here",
    body: "You can now **share a track** with a friend.",
  },
  read: false,
  createdAt: new Date().toISOString(),
};

describe("NotificationsPanel: an announcement", () => {
  // Mutation: drop `setMessage(announcement)` from `openNotification`, or its
  // `setRead` call.
  it("opens its message from the row and marks it read", () => {
    const noop = () => {};
    render(
      <ToastProvider>
        <NotificationsPanel
          notifications={[announcement]}
          notificationsLoaded
          notificationsError={null}
          notificationsTotal={1}
          onRefetchNotifications={noop}
          onOverrideRead={noop}
          onRefetchFriends={noop}
          setSelectedPlaceID={noop}
          setActivePanel={noop}
          onMapsViewChange={noop}
          onTopoFlyTarget={noop}
        />
      </ToastProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Track sharing is here" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Track sharing is here",
    });
    expect(dialog.querySelector("strong")?.textContent).toBe("share a track");
    expect(api.markNotificationRead).toHaveBeenCalledWith("n1", true);
  });
});
