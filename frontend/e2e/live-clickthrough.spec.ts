import { test, expect } from "@playwright/test";
import path from "path";

const OUTPUT_DIR = path.resolve(process.cwd(), "../private/redesign-reference/pilot");

test("live clickthrough against live backend at http://localhost:5173", async ({ page }) => {
  // Navigate directly to live running instance with NO mocks
  await page.goto("http://localhost:5173/");

  // Wait for map canvas to be loaded and active
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15_000 });

  // 1. Locate and click the Inbox button in the sidebar rail
  const inboxRailButton = page.getByRole("button", { name: /^Inbox/ });
  await expect(inboxRailButton).toBeVisible();
  await inboxRailButton.click();

  // 2. Verify Inbox panel opens with its Hero
  const inboxSection = page.locator("section[aria-label='Inbox']");
  await expect(inboxSection).toBeVisible();

  // Verify Hero heading exists
  const heroHeading = inboxSection.getByRole("heading", { level: 2 });
  await expect(heroHeading).toBeVisible();
  console.log("Hero heading:", await heroHeading.textContent());

  // 3. Verify ChipRail exists and check chip counts
  const chipRail = inboxSection.getByRole("radiogroup", { name: "Inbox filter" });
  await expect(chipRail).toBeVisible();

  const allRadio = page.getByRole("radio", { name: /^All/ });
  const unreadRadio = page.getByRole("radio", { name: /^Unread/ });
  const readRadio = page.getByRole("radio", { name: /^Read/ });

  await expect(allRadio).toBeVisible();
  await expect(unreadRadio).toBeVisible();
  await expect(readRadio).toBeVisible();

  // 4. Click through filter radio chips
  await unreadRadio.click();
  await expect(unreadRadio).toHaveAttribute("aria-checked", "true");

  await readRadio.click();
  await expect(readRadio).toHaveAttribute("aria-checked", "true");

  await allRadio.click();
  await expect(allRadio).toHaveAttribute("aria-checked", "true");

  // 5. Click through Search functionality
  const searchToggleButton = page.getByRole("button", { name: "Search inbox" });
  await expect(searchToggleButton).toBeVisible();
  await searchToggleButton.click();

  const searchInput = page.getByRole("searchbox", { name: "Search inbox" });
  await expect(searchInput).toBeVisible();
  await searchInput.fill("carol");

  // Verify filtering by query
  await expect(inboxSection.getByText(/carol/i)).toBeVisible();

  // Clear search and close search field
  await searchInput.press("Escape");

  // 6. Test Multi-selection clickthrough
  const alertCheckboxes = inboxSection.getByRole("checkbox", { name: "Select alert" });
  const count = await alertCheckboxes.count();
  expect(count).toBeGreaterThan(0);

  // Click first alert checkbox
  await alertCheckboxes.nth(0).click();

  // Verify SelectionBar replaced ChipRail
  const selectionBar = inboxSection.getByRole("group", { name: "Selection" });
  await expect(selectionBar).toBeVisible();
  await expect(inboxSection.getByText(/selected/)).toBeVisible();

  // Select second alert with Shift+Click
  if (count > 1) {
    await alertCheckboxes.nth(1).click({ modifiers: ["Shift"] });
    await expect(inboxSection.getByText(/2 selected/)).toBeVisible();
  }

  // Deselect via Escape key
  await page.keyboard.press("Escape");
  await expect(selectionBar).not.toBeVisible();
  await expect(chipRail).toBeVisible();

  // 7. Test Row Context Menu (⋯)
  const firstRowMenuButton = inboxSection.getByRole("button", { name: /^Actions for/ }).first();
  await expect(firstRowMenuButton).toBeVisible();
  await firstRowMenuButton.click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Mark as (read|unread)/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Delete notification" })).toBeVisible();

  // Dismiss menu via Escape
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();

  // 8. Capture a live unmocked screenshot
  await page.screenshot({ path: path.join(OUTPUT_DIR, "live-unmocked-inbox.png"), fullPage: false });
  console.log("Successfully verified all clickthrough interactions on live app!");
});
