import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility checks for the redesigned surfaces of Logjam Web: the
// shell (rail, map chrome), Places with its filter sheet, the Layers popover and
// the narrow-web tab bar. axe finds roughly a third of WCAG failures — contrast,
// names, roles, landmarks — so this is a floor, not a verdict; keyboard order and
// focus return are checked by hand (frontend/DESIGN.md).
//
// Local only: it needs fake auth and a seeded API, and prod smoke stays
// auth-free (e2e/CLAUDE.md).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(!baseURL.startsWith("http://localhost"), "needs the local fake-auth stack");

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
  const { violations } = await builder.analyze();
  // Name each failure and the elements it hit, so a red run says what to fix.
  const summary = violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
  expect(summary).toEqual([]);
}

async function openApp(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 15_000 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the shell: rail and map chrome", async ({ page }) => {
    await openApp(page);
    await expectNoViolations(page, "nav[aria-label='Pages']");
    await expectNoViolations(page, "#map");
  });

  test("Places, its filter sheet and a row menu", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await expect(page.locator("[data-place-id]").first()).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    await page.getByRole("button", { name: /^Sort and filter/ }).click();
    await expect(page.getByRole("heading", { name: "Sort and filter" })).toBeFocused();
    await expectNoViolations(page, "aside");

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: /^Actions for / }).first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
  });

  test("the Inbox, a row menu and a selection", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    const inbox = page.locator("aside");
    await expect(inbox.getByRole("checkbox").first()).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    await inbox.getByRole("button", { name: /^Actions for / }).first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
    await page.keyboard.press("Escape");

    // Selecting swaps the rail for the bar; Escape clears it.
    await inbox.getByRole("checkbox").first().click();
    await expect(inbox.getByRole("group", { name: "Selection" })).toBeVisible();
    await expectNoViolations(page, "aside");
    await page.keyboard.press("Escape");
    await expect(inbox.getByRole("radiogroup", { name: "Show" })).toBeVisible();
  });

  test("a confirm dialog", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    const rowMenu = page.locator("aside").getByRole("button", { name: /^Actions for / }).first();
    await expect(rowMenu).toBeVisible({ timeout: 15_000 });
    await rowMenu.click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("heading", { level: 2 })).toBeFocused();
    await expectNoViolations(page, "dialog");

    // Escape cancels, deletes nothing, and returns focus to the row's ⋯.
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(rowMenu).toBeFocused();
  });

  test("a discard confirm over a form dialog", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await page.getByRole("button", { name: /^Add/ }).first().click();
    await page.getByRole("menuitem", { name: "Add a place" }).click();
    const form = page.locator(".MuiDialog-root [role='dialog']");
    await expect(form).toBeVisible();
    await form.getByLabel(/^Name/).first().fill("Unsaved name");

    // The Escape that asks the form to close raises the confirm, and must not
    // also be the close request that dismisses it.
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    await expect(confirm).toBeVisible();
    await page.waitForTimeout(300);
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("heading", { level: 2 })).toBeFocused();

    // Its own Escape closes only the confirm, and the typing survives.
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    await expect(form).toBeVisible();
    await expect(form.getByLabel(/^Name/).first()).toHaveValue("Unsaved name");
  });

  test("Logs, a trip, its form, and Stats", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Logs", exact: true }).click();
    const aside = page.locator("aside");
    await expect(aside.getByRole("heading", { level: 2, name: /trips?$/ })).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    const rowMenu = aside.getByRole("button", { name: /^Actions for / }).first();
    await rowMenu.click();
    await page.getByRole("menuitem", { name: "Open trip" }).click();
    const view = page.locator("dialog[open]");
    await expect(view.getByRole("button", { name: "Edit trip" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Edit swaps the view for the form, focus on its first field.
    await view.getByRole("button", { name: "Edit trip" }).click();
    const form = page.getByRole("dialog", { name: "Edit trip" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Date")).toBeFocused();
    await expectNoViolations(page, "dialog");

    // An untouched form closes on Escape without asking.
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();

    await aside.getByRole("radio", { name: "Stats" }).click();
    await expect(aside.getByRole("heading", { level: 2, name: /out$/ })).toBeVisible();
    await expectNoViolations(page, "aside");
  });

  test("Ways, a row menu, a route and the draw tool", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Ways", exact: true }).click();
    const aside = page.locator("aside");
    await expect(aside.getByRole("heading", { level: 2, name: /lines?$/ })).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    const rowMenu = aside.getByRole("button", { name: /^Actions for / }).first();
    await rowMenu.click();
    await expect(page.getByRole("menu")).toBeVisible();
    // Reverse is a button in the draw tool now, never a menu item: it changes
    // the geometry on screen, so it belongs beside the other edits to it.
    await expect(page.getByRole("menuitem", { name: "Reverse direction" })).toHaveCount(0);
    await expectNoViolations(page, "[role='menu']");
    await page.keyboard.press("Escape");

    // A route's own page: its stats, its colour picker and its place link.
    // Opened through the row's own menu: `Row`'s stretched open button is named
    // after the row's title, which is a route name we cannot know here.
    await aside.locator("[data-way-kind='route']").first().getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();

    // The colour is a FIELD showing its value, not ten swatches laid out flat;
    // the palette is a popover behind it, so both states are checked.
    const colour = aside.getByRole("button", { name: /^Colour on the map:/ });
    await expect(colour).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    await colour.click();
    await expect(page.getByRole("group", { name: "Colour on the map" })).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Colour on the map']");
    await page.keyboard.press("Escape");
    await expect(colour).toBeFocused();

    // The draw tool is a PAGE in the panel, not a card over the map.
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "Draw a route" }).click();
    await expect(aside.getByRole("heading", { level: 2, name: "New route" })).toBeVisible();
    await expectNoViolations(page, "aside");
    await aside.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("the Layers popover", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Map layers" })).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Map layers']");

    // Escape closes it and puts focus back on the button that opened it.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Layers", exact: true })).toBeFocused();
  });
});

test.describe("narrow web", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the tab bar and its More menu", async ({ page }) => {
    await openApp(page);
    await expectNoViolations(page, "nav[aria-label='Pages']");
    await page.getByRole("button", { name: /^More/ }).click();
    await expect(page.getByRole("menu", { name: "More pages" })).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
  });
});
