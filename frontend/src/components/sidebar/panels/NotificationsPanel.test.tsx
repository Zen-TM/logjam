import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import NotificationsPanel from "./NotificationsPanel";
import type { TNotification } from "../../../placeUtils";

// Mock placeUtils methods
vi.mock("../../../placeUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../placeUtils")>();
  return {
    ...actual,
    markNotificationRead: vi.fn().mockResolvedValue({}),
    markAllNotificationsRead: vi.fn().mockResolvedValue({}),
    clearReadNotifications: vi.fn().mockResolvedValue({}),
    deleteNotification: vi.fn().mockResolvedValue({}),
    acceptFriendRequest: vi.fn().mockResolvedValue({}),
    declineFriendRequest: vi.fn().mockResolvedValue({}),
    getTopoExport: vi.fn().mockResolvedValue({ downloadUrl: "http://example.com/topo.zip" }),
    getGeoPdfJob: vi.fn().mockResolvedValue({ downloadUrl: "http://example.com/geo.pdf" }),
  };
});

// Mock toast
vi.mock("../../feedback/ToastProvider", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("NotificationsPanel", () => {
  const dummyNotifications: TNotification[] = [
    {
      id: "n1",
      type: "friend_request",
      payload: { friendshipId: "f1", requesterUsername: "alice" },
      read: false,
      createdAt: "2026-07-20T10:00:00.000Z",
    },
    {
      id: "n2",
      type: "topo_complete",
      payload: {
        topoId: "t1",
        jobName: "Blue Mountains Topo",
        footprint: {
          type: "Polygon",
          coordinates: [
            [
              [150, -33],
              [151, -33],
              [151, -34],
              [150, -34],
              [150, -33],
            ],
          ],
        },
      },
      read: true,
      createdAt: "2026-07-19T10:00:00.000Z",
    },
    {
      id: "n3",
      type: "place_shared",
      payload: { placeId: "p1", placeName: "Kanangra Falls", sharedByUsername: "bob" },
      read: false,
      createdAt: "2026-07-18T10:00:00.000Z",
    },
  ];

  const defaultProps = {
    notifications: dummyNotifications,
    notificationsTotal: 3,
    onRefetchNotifications: vi.fn(),
    onRefetchFriends: vi.fn(),
    setSelectedPlaceID: vi.fn(),
    setActivePanel: vi.fn(),
    onTopoFlyTarget: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("calls onRefetchNotifications on mount", () => {
    render(<NotificationsPanel {...defaultProps} />);
    expect(defaultProps.onRefetchNotifications).toHaveBeenCalledTimes(1);
  });

  it("displays hero title with unread count when unread alerts exist", () => {
    render(<NotificationsPanel {...defaultProps} />);
    expect(screen.getByText("2 unread")).toBeTruthy();
  });

  it("displays 'All caught up' when all alerts are read", () => {
    const allRead = dummyNotifications.map((n) => ({ ...n, read: true }));
    render(<NotificationsPanel {...defaultProps} notifications={allRead} />);
    expect(screen.getByText("All caught up")).toBeTruthy();
  });

  it("displays 'Nothing yet' when notification list is empty", () => {
    render(<NotificationsPanel {...defaultProps} notifications={[]} notificationsTotal={0} />);
    expect(screen.getAllByText("Nothing yet").length).toBeGreaterThan(0);
  });

  it("renders friend request action buttons (Accept and Decline)", () => {
    render(<NotificationsPanel {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decline" })).toBeTruthy();
  });

  it("renders 'Zoom to map' button for topo complete notifications", () => {
    render(<NotificationsPanel {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Zoom to map" })).toBeTruthy();
  });

  it("filters notifications by chip rail (Unread and Read)", () => {
    render(<NotificationsPanel {...defaultProps} />);

    // Click Unread chip
    const unreadChip = screen.getByRole("radio", { name: /Unread/ });
    fireEvent.click(unreadChip);

    // Should show Alice and Bob, but not Blue Mountains Topo (which is read)
    expect(screen.getByText("alice sent you a friend request")).toBeTruthy();
    expect(screen.getByText("bob shared Kanangra Falls with you")).toBeTruthy();
    expect(screen.queryByText(/Blue Mountains Topo/)).toBeNull();

    // Click Read chip
    const readChip = screen.getByRole("radio", { name: /Read/ });
    fireEvent.click(readChip);

    expect(screen.queryByText("alice sent you a friend request")).toBeNull();
    expect(screen.getByText(/Blue Mountains Topo/)).toBeTruthy();
  });

  it("enters selection mode when a tile checkbox is clicked", () => {
    render(<NotificationsPanel {...defaultProps} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(3);

    // Click first checkbox
    fireEvent.click(checkboxes[0]);

    // Selection bar should now be displayed
    expect(screen.getByText(/1 selected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear selection (Esc)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete selected" })).toBeTruthy();
  });
});
