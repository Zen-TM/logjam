import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
// jsdom has no Popover API either, and treats a closed `popover` as
// unrendered: showing it drops the attribute.
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
  togglePopover() {},
});
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

const noop = () => {};
const renderPanel = () =>
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

describe("NotificationsPanel: an announcement", () => {
  // Mutation: drop `setMessageOf(n)` from `openNotification`, or the `setRead`
  // in the dialog's `onClose`.
  it("opens its message from the row and is read once it closes", () => {
    renderPanel();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Track sharing is here" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Track sharing is here",
    });
    expect(dialog.querySelector("strong")?.textContent).toBe("share a track");
    expect(api.markNotificationRead).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.markNotificationRead).toHaveBeenCalledWith("n1", true);
  });

  // Mutation: drop the "Read message" entry from `rowEntries`.
  it("opens its message from the row's ⋯", () => {
    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Track sharing is here" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Read message" }));

    expect(
      screen.getByRole("dialog", { name: "Track sharing is here" }),
    ).toBeTruthy();
  });
});
