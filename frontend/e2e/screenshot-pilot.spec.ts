import { test, expect, type Page } from "@playwright/test";
import path from "path";

const OUTPUT_DIR = path.resolve(process.cwd(), "../private/redesign-reference/pilot");

const sampleNotifications = [
  {
    id: "n-friend-1",
    type: "friend_request",
    payload: { friendshipId: "f1", requesterUsername: "sarah_canyons" },
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: "n-topo-1",
    type: "topo_complete",
    payload: {
      topoId: "t1",
      jobName: "Claustral Canyon Topo",
      footprint: {
        type: "Polygon",
        coordinates: [
          [
            [150.3, -33.5],
            [150.4, -33.5],
            [150.4, -33.6],
            [150.3, -33.6],
            [150.3, -33.5],
          ],
        ],
      },
    },
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: "n-share-1",
    type: "place_shared",
    payload: {
      placeId: "p1",
      placeName: "Rocky Creek Canyon",
      sharedByUsername: "dave_o",
    },
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: "n-file-1",
    type: "file_sent",
    payload: {
      filename: "kanangra_waypoints.gpx",
      sentByUsername: "alex_m",
    },
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: "n-friend-acc-1",
    type: "friend_request_accepted",
    payload: {
      acceptedByUsername: "marcus_w",
    },
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
];

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15_000 });
}

async function setupMocks(page: Page, notifications: unknown[], unreadCount: number, delayMs = 0) {
  await page.route("http://localhost:8080/notifications/unread-count*", async (route) => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: unreadCount }),
    });
  });

  await page.route(/^http:\/\/localhost:8080\/notifications(\?.*)?$/, async (route) => {
    if (route.request().method() === "GET") {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-total-count": String(notifications.length) },
        body: JSON.stringify(notifications),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    }
  });
}

test.describe("pilot screenshots - desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("1. empty state", async ({ page }) => {
    await setupMocks(page, [], 0);
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing yet" })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-empty.png"), fullPage: false });
  });

  test("2. loading state", async ({ page }) => {
    await setupMocks(page, sampleNotifications, 3, 15_000);
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    // Capture during initial fetch loading
    await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-loading.png"), fullPage: false });
  });

  test("3. full state", async ({ page }) => {
    await setupMocks(page, sampleNotifications, 3);
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByText("3 unread")).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-full.png"), fullPage: false });
  });

  test("4. with friend request", async ({ page }) => {
    const friendOnly = [sampleNotifications[0]];
    await setupMocks(page, friendOnly, 1);
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-friend-request.png"), fullPage: false });
  });

  test("5. with unread topo", async ({ page }) => {
    const topoOnly = [sampleNotifications[1]];
    await setupMocks(page, topoOnly, 1);
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByText("Claustral Canyon Topo map ready")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom to map" })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-unread-topo.png"), fullPage: false });
  });

  test("6. during bulk selection", async ({ page }) => {
    await setupMocks(page, sampleNotifications, 3);
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    const checkboxes = page.getByRole("checkbox", { name: "Select alert" });
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await expect(page.getByText(/2 selected/)).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-bulk-selection.png"), fullPage: false });
  });
});

test.describe("pilot screenshots - mobile 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("1. empty state", async ({ page }) => {
    await setupMocks(page, [], 0);
    await openApp(page);
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing yet" })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-empty.png"), fullPage: false });
  });

  test("2. loading state", async ({ page }) => {
    await setupMocks(page, sampleNotifications, 3, 10_000);
    await openApp(page);
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-loading.png"), fullPage: false });
  });

  test("3. full state", async ({ page }) => {
    await setupMocks(page, sampleNotifications, 3);
    await openApp(page);
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByText("3 unread")).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-full.png"), fullPage: false });
  });

  test("4. with friend request", async ({ page }) => {
    const friendOnly = [sampleNotifications[0]];
    await setupMocks(page, friendOnly, 1);
    await openApp(page);
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-friend-request.png"), fullPage: false });
  });

  test("5. with unread topo", async ({ page }) => {
    const topoOnly = [sampleNotifications[1]];
    await setupMocks(page, topoOnly, 1);
    await openApp(page);
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    await expect(page.getByText("Claustral Canyon Topo map ready")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom to map" })).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-unread-topo.png"), fullPage: false });
  });

  test("6. during bulk selection", async ({ page }) => {
    await setupMocks(page, sampleNotifications, 3);
    await openApp(page);
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
    await expect(page.locator("section[aria-label='Inbox']")).toBeVisible();
    const checkboxes = page.getByRole("checkbox", { name: "Select alert" });
    await checkboxes.nth(0).click();
    await checkboxes.nth(1).click();
    await expect(page.getByText(/2 selected/)).toBeVisible();
    await page.screenshot({ path: path.join(OUTPUT_DIR, "mobile-bulk-selection.png"), fullPage: false });
  });
});
