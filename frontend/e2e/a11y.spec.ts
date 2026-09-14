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
