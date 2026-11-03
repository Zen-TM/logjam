import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INBOX } from "@logjam/shared";
import { withReadOverrides } from "../../../notificationReadOverrides";
import type { TNotification } from "../../../placeUtils";
import { ToastProvider } from "../../feedback/ToastProvider";
import NotificationsPanel from "./NotificationsPanel";

const api = vi.hoisted(() => ({
  markNotificationRead: vi.fn(async () => {}),
}));
const plans = vi.hoisted(() => ({
  joinPlan: vi.fn(async () => {}),
  leavePlan: vi.fn(async () => {}),
  approveMember: vi.fn(async () => {}),
  removeMember: vi.fn(async () => {}),
}));
vi.mock("../../../plansApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plansApi")>()),
  ...plans,
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

// Read marks really apply, as App's do, so a row read in Unread leaves it.
function Harness({
  rows,
  onOpenRoute = async () => true,
}: {
  rows: TNotification[];
  onOpenRoute?: (routeId: string) => Promise<boolean>;
}) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
    new Map(),
  );
  const notifications = withReadOverrides(rows, overrides);
  return (
    <ToastProvider>
      <NotificationsPanel
        notifications={notifications}
        notificationsLoaded
        notificationsError={null}
        notificationsTotal={notifications.length}
        onRefetchNotifications={noop}
        onOverrideRead={(ids, read) =>
          setOverrides((prev) => {
            const next = new Map(prev);
            for (const id of ids) {
              if (read === null) next.delete(id);
              else next.set(id, read);
            }
            return next;
          })
        }
        onRefetchFriends={noop}
        onRefetchPlans={noop}
        setSelectedPlaceID={noop}
        setActivePanel={noop}
        onShowSharpened={noop}
        onTopoFlyTarget={noop}
        onOpenPlan={noop}
        onOpenRoute={onOpenRoute}
      />
    </ToastProvider>
  );
}

const renderPanel = (rows = [announcement]) => render(<Harness rows={rows} />);

// Opens a row's message from the Unread chip and closes it, as a keyboard user
// would: `fireEvent.click` moves no focus, so the row takes it first.
function readInUnread(title: string) {
  fireEvent.click(screen.getByRole("radio", { name: /^Unread/ }));
  const row = screen.getByRole("button", { name: title });
  row.focus();
  fireEvent.click(row);
  const dialog = screen.getByRole("dialog", { name: title });
  fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[1]!);
}

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

    fireEvent.click(
      within(dialog).getAllByRole("button", { name: "Close" })[1]!,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.markNotificationRead).toHaveBeenCalledWith("n1", true);
  });

  // Mutation: drop the announcement's button from `rowFooter`.
  it("opens its message from the row's Read message button", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Read message" }));

    expect(
      screen.getByRole("dialog", { name: "Track sharing is here" }),
    ).toBeTruthy();
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

  // Mutation: drop the refocus on close (focus falls to <body> with the row),
  // or pick the previous row before the next.
  it("in Unread, hands focus to the next row once it is read and leaves", () => {
    const older: TNotification = {
      ...announcement,
      id: "n2",
      payload: {
        ...announcement.payload,
        announcementId: "a2",
        title: "Older news",
      },
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    };
    const oldest: TNotification = {
      ...older,
      id: "n3",
      payload: { ...older.payload, announcementId: "a3", title: "Oldest news" },
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    };
    renderPanel([announcement, older, oldest]);
    readInUnread("Older news");

    expect(api.markNotificationRead).toHaveBeenCalledWith("n2", true);
    expect(screen.queryByRole("button", { name: "Older news" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Oldest news" }),
    );
  });

  // Mutation: drop the title fallback when no row is left.
  it("in Unread, hands focus to the Inbox title when it was the only row", () => {
    renderPanel();
    readInUnread("Track sharing is here");

    expect(api.markNotificationRead).toHaveBeenCalledWith("n1", true);
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: INBOX.title }),
    );
  });
});

const planRow = (type: string, payload: Record<string, unknown>) =>
  ({
    id: "n2",
    type,
    payload: { planId: "p1", planName: "Kanangra Walls loop", ...payload },
    read: false,
    createdAt: new Date().toISOString(),
  }) as TNotification;

// A plan's invite and a join request answer in the row, as a friend request
// does. Mutation: return null for either kind in `notificationActions`, or
// wire Accept on a join request to `joinPlan`.
describe("NotificationsPanel: plan questions", () => {
  it("accepts an invite from the row", async () => {
    renderPanel([planRow("plan_invited", { invitedByUsername: "carol" })]);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await vi.waitFor(() => expect(plans.joinPlan).toHaveBeenCalledWith("p1"));
  });

  it("accepts a join request from the row", async () => {
    renderPanel([
      planRow("plan_join_request", {
        requesterId: "u2",
        requesterUsername: "carol",
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await vi.waitFor(() =>
      expect(plans.approveMember).toHaveBeenCalledWith("p1", "u2"),
    );
  });

  it("declines a join request after asking", async () => {
    renderPanel([
      planRow("plan_join_request", {
        requesterId: "u2",
        requesterUsername: "carol",
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(plans.removeMember).not.toHaveBeenCalled();
    const ask = screen.getByRole("alertdialog", { name: "Decline carol?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Decline" }));
    await vi.waitFor(() =>
      expect(plans.removeMember).toHaveBeenCalledWith("p1", "u2", "requested"),
    );
  });
});

describe("NotificationsPanel: a shared route", () => {
  const shared: TNotification = {
    id: "n2",
    type: "item_shared",
    payload: { entityType: "route", entityId: "r1", sharedByUsername: "bob" },
    read: false,
    createdAt: new Date().toISOString(),
  };

  // Mutation: drop the `way` branch from `goTo`, and the tap opens nothing.
  it("opens the route when the row is tapped, and reads it", () => {
    const onOpenRoute = vi.fn(async () => true);
    render(<Harness rows={[shared]} onOpenRoute={onOpenRoute} />);
    fireEvent.click(
      screen.getByRole("button", { name: "bob shared a route with you" }),
    );
    expect(onOpenRoute).toHaveBeenCalledWith("r1");
    expect(api.markNotificationRead).toHaveBeenCalledWith("n2", true);
  });

  // Mutation: ignore the false return, and a revoked share fails silently.
  it("says so when the route is gone", async () => {
    render(<Harness rows={[shared]} onOpenRoute={async () => false} />);
    fireEvent.click(
      screen.getByRole("button", { name: "bob shared a route with you" }),
    );
    expect(await screen.findByText("This was removed.")).toBeTruthy();
  });
});
