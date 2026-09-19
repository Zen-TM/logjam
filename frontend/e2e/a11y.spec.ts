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

/**
 * A surface is measured once it has finished ARRIVING.
 *
 * `Dialog` fades itself in (`@starting-style`, DESIGN.md §6), and axe computes
 * contrast from what is PAINTED — so a check running while the dialog is
 * half-way there measures its colours composited against the page behind it
 * and reports both a shade light. That is not hypothetical: it failed
 * `textMuted` on `secondary` at 4.23:1, a pair that measures a passing 4.60:1
 * once the dialog has landed. It only shows up at all because that pair ships
 * with 0.10 of margin (`scripts/wcag-contrast.mjs`), which is worth knowing
 * on its own — anything translucent over a card's caption is under AA.
 */
async function settled(page: Page) {
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dialog[open]")].every(
      (dialog) => Number(getComputedStyle(dialog).opacity) === 1,
    ),
  );
}

async function expectNoViolations(page: Page, include?: string) {
  await settled(page);
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

  test("Friends, a request, the sharing audit and the share dialog", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Friends", exact: true }).click();
    const aside = page.locator("aside");
    // A request carries its verbs on the card's own footer; a friend carries a ⋯.
    await expect(aside.getByRole("button", { name: "Accept" })).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    // Adding someone is a dialog, not a box above the list.
    await aside.getByRole("button", { name: "Add", exact: true }).click();
    const addDialog = page.locator("dialog[open]");
    await expect(addDialog.getByRole("searchbox", { name: "Search by username" })).toBeFocused();
    await addDialog.getByRole("searchbox").fill("car");
    await expect(addDialog.getByRole("button", { name: "Add", exact: true })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(addDialog).toHaveCount(0);

    // The audit replaces the list: a hero with a way back, a direction rail and
    // one row per shared thing, of every kind.
    await aside.getByRole("button", { name: "bob", exact: true }).click();
    await expect(aside.getByRole("radio", { name: /^You share/ })).toBeVisible();
    await expect(aside.getByRole("button", { name: "Unshare" }).first()).toBeVisible();
    await expectNoViolations(page, "aside");

    await aside.getByRole("radio", { name: /^They share/ }).click();
    await expectNoViolations(page, "aside");

    // Selecting swaps the rail for the bar at the same height, and the bulk
    // confirm names the blast radius rather than asking "sure?".
    await aside.getByRole("radio", { name: /^You share/ }).click();
    await aside.getByRole("checkbox").first().click();
    await expect(aside.getByRole("group", { name: "Selection" })).toBeVisible();
    await expectNoViolations(page, "aside");

    await aside.getByRole("button", { name: /^Unshare 1 from/ }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectNoViolations(page, "[role='alertdialog']");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    // Escape clears the selection, as it does on every other list.
    await page.keyboard.press("Escape");
    await expect(aside.getByRole("group", { name: "Selection" })).toHaveCount(0);
  });

  test("Account, Settings and the three lists it keeps", async ({ page }) => {
    await openApp(page);
    const aside = page.locator("aside");

    // Account leads with who you are and the two quota meters.
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await expect(aside.getByRole("button", { name: "Change username" })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");

    // The one dialog here that a typed phrase guards.
    await aside.getByRole("button", { name: "Delete account" }).click();
    const deleteDialog = page.locator("dialog[open]");
    await expect(
      deleteDialog.getByRole("button", { name: "Delete account" }),
    ).toBeDisabled();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(deleteDialog).toHaveCount(0);

    // Settings is a plain list — no hero — of switches and the lists you keep.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(aside.getByRole("radiogroup", { name: "Theme" })).toBeVisible();
    await expectNoViolations(page, "aside");

    // A list opens in place, with the arrow back out (DESIGN.md §2).
    await aside.getByRole("button", { name: /^Place types/ }).click();
    await expect(aside.getByRole("heading", { name: "Place types" })).toBeVisible();
    await expectNoViolations(page, "aside");

    // Its editor is a DIALOG, like every other create in the app, and its form
    // is the icon grid and the swatch line, both radio groups.
    await aside.getByRole("button", { name: "Add", exact: true }).click();
    const typeDialog = page.locator("dialog[open]");
    await expect(typeDialog.getByRole("radiogroup", { name: "Icon" })).toBeVisible();
    await expectNoViolations(page, "dialog");
    // The palette names its colours; a hex is a name but not a helpful one.
    await typeDialog.getByRole("button", { name: /^Colour:/ }).click();
    await expect(page.getByRole("radio", { name: "Pool teal" })).toBeVisible();
    await expectNoViolations(page, "[role='dialog']");
    // The palette's Escape is its own: the dialog under it stays open.
    await page.keyboard.press("Escape");
    await expect(typeDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(typeDialog).toHaveCount(0);

    await aside.getByRole("button", { name: "Back to Settings" }).click();

    // The attributes list: yours with verbs, the built-ins without.
    await aside.getByRole("button", { name: /^Place attributes/ }).click();
    await expect(aside.getByRole("heading", { name: /Built in/ })).toBeVisible();
    await expectNoViolations(page, "aside");

    // A row opens the same dialog on an existing one, with the type fixed.
    await aside
      .getByRole("button", { name: /^Access beta/ })
      .first()
      .click();
    const attrDialog = page.locator("dialog[open]");
    // The type is a FACT on an existing attribute, not a control that cannot
    // be operated: no picker, and the shape it already stores in words.
    await expect(attrDialog.getByRole("radiogroup", { name: "Type" })).toHaveCount(0);
    await expect(attrDialog.getByText("Text", { exact: true })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
  });

  test("Places, its filter sheet and a row menu", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const aside = page.locator("aside");
    await expect(aside.locator("[data-place-id]").first()).toBeVisible({ timeout: 15_000 });

    // NARROW THE LIST BEFORE WALKING IT. axe is per-element, and this account
    // holds 311 places whose rows are one component repeated — so the walk
    // answers the same question 311 times and charges 7.4s for it against 0.17s
    // for two rows, with an identical result. Three walks of that put the case
    // at 51.7s alone and over the 60s cap under any parallel load; it is the
    // seed growing from 37 places, not the app, that was failing it. Everything
    // the case is about survives the search: the hero, both chip rails, the
    // sort-and-filter button, a row and its menu.
    await aside.getByRole("button", { name: /^Search/ }).click();
    await aside.getByRole("searchbox").first().fill("claustral");
    await expect(aside.getByRole("radio", { name: /^Any type/ })).toBeVisible();
    await expect.poll(() => aside.locator("[data-place-id]").count()).toBeLessThan(10);
    await expectNoViolations(page, "aside");

    await page.getByRole("button", { name: /^Sort and filter/ }).click();
    await expect(page.getByRole("heading", { name: "Sort and filter" })).toBeFocused();
    await expectNoViolations(page, "aside");

    // `exact`, because an accessible name matches as a SUBSTRING by default and
    // this list is the user's own data: a place called "Closet" is three of the
    // "Close" buttons on this page (its own row, its ⋯, and the sheet's).
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: /^Actions for / }).first().click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
  });

  test("a place's own page, its verbs and its form", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const list = page.locator("aside");
    await expect(list.locator("[data-place-id]").first()).toBeVisible({ timeout: 15_000 });
    await list.getByRole("button", { name: "Claustral Canyon", exact: true }).click();

    // The page leads with the place's name, and every attribute is stated once
    // — the four canyon scalars used to be printed by name AND again by the
    // loop over the type's definitions.
    await expect(list.getByRole("heading", { level: 2, name: "Claustral Canyon" })).toBeVisible();
    await expect(list.getByText("Longest pitch", { exact: true })).toHaveCount(1);
    await expectNoViolations(page, "aside");

    // The verbs are `placeVerbs`: a menu, not a footer of buttons.
    await list.getByRole("button", { name: /^Actions for / }).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Edit place" })).toBeVisible();
    await expectNoViolations(page, "[role='menu']");

    // The grades are rails now, drawn from their definitions' bounds.
    await menu.getByRole("menuitem", { name: "Edit place" }).click();
    const form = page.getByRole("dialog", { name: "Edit place" });
    await expect(form.getByRole("radiogroup", { name: "V grade" })).toBeVisible();
    await expect(form.getByRole("radiogroup", { name: "Type" })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
  });

  test("a selection of places, and what can be done with it", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const list = page.locator("aside");
    await expect(list.locator("[data-place-id]").first()).toBeVisible({ timeout: 15_000 });

    // The tile IS the checkbox (DESIGN.md §7), and the bar replaces the rail.
    await list.getByRole("checkbox").first().click();
    await list.getByRole("button", { name: "Share or export" }).click();

    const dialog = page.getByRole("dialog", { name: /place/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Export" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // The destructive verb confirms, and says what goes and what stays.
    await dialog.getByRole("button", { name: /^Delete / }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("stay in your logbook");
    await expectNoViolations(page, "[role='alertdialog']");
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
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
    // The kit dialog, not MUI's: the place form was rebuilt onto `Dialog`
    // (a native <dialog>), so the confirm now stands over one of our own.
    const form = page.getByRole("dialog", { name: "Add a place" });
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

    // A trip is READ on its own PAGE, not in a dialog (DESIGN.md §6).
    const rowMenu = aside.getByRole("button", { name: /^Actions for / }).first();
    await rowMenu.click();
    await page.getByRole("menuitem", { name: "Open trip" }).click();
    await expect(aside.getByRole("heading", { name: "Places" })).toBeVisible();
    await expectNoViolations(page, "aside");

    // ...and the form that edits it is the dialog that page raises.
    await aside.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit trip" }).click();
    const form = page.getByRole("dialog", { name: "Edit trip" });
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Date")).toBeFocused();
    await expectNoViolations(page, "dialog");

    // An untouched form closes on Escape without asking, leaving the page.
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await expect(aside.getByRole("heading", { name: "Notes" })).toBeVisible();

    // Back to the logbook, where Stats is the other view.
    await aside.getByRole("button", { name: "Back to Logs" }).click();
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
    const colour = aside.getByRole("button", { name: /^Colour:/ });
    await expect(colour).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    await colour.click();
    await expect(page.getByRole("group", { name: "Colour" })).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Colour']");
    await page.keyboard.press("Escape");
    await expect(colour).toBeFocused();

    // The draw tool is a PAGE in the panel, not a card over the map.
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "Draw a route" }).click();
    await expect(aside.getByRole("heading", { level: 2, name: "New route" })).toBeVisible();
    await expectNoViolations(page, "aside");
    await aside.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("Maps: both views, a row menu, the topo style sheet and its colour", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    const aside = page.locator("aside");
    await aside.getByRole("radio", { name: "GeoPDFs" }).click();
    // Loaded, not the placeholder title ("GeoPDFs" while the list is loading).
    await expect(aside.getByRole("heading", { level: 2, name: /^(No GeoPDFs yet|\d+ GeoPDFs?)$/ })).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    await aside.getByRole("radio", { name: "LiDAR topos" }).click();
    await expect(aside.getByRole("heading", { level: 2, name: /^(No LiDAR topos yet|\d+ LiDAR topos?)$/ })).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    // The built-in Default template is always there, so there is always a menu —
    // on the Templates tab, which is where a template lives now.
    await aside.getByRole("radio", { name: /^Templates/ }).click();
    await aside.getByRole("button", { name: "Actions for Default" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
    await page.keyboard.press("Escape");

    // How topos draw opens BESIDE the page, and its colours are free pickers.
    await aside.getByRole("button", { name: "Topo style" }).click();
    const sheet = page.getByRole("region", { name: "Topo style" });
    await expect(sheet.getByRole("slider", { name: "Label size" })).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");
    const major = sheet.getByRole("button", { name: /^Major colour:/ });
    await major.click();
    await expect(page.getByRole("slider", { name: "Hue" })).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Major colour']");
    await page.keyboard.press("Escape");
    await expect(major).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(aside.getByRole("button", { name: "Topo style" })).toBeFocused();
  });

  test("Make a LiDAR topo, its ELVIS steps and its settings", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    const aside = page.locator("aside");
    await aside.getByRole("radio", { name: "LiDAR topos" }).click();
    await aside.getByRole("button", { name: /^Make/ }).first().click();
    await page.getByRole("menuitem", { name: /LiDAR topo/ }).click();

    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("heading", { name: "Make a LiDAR topo" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // The errand and the settings are SUB-VIEWS: each swaps the body, and each
    // backs out to the form rather than out of the dialog.
    await dialog.getByRole("button", { name: /^Haven.t got one/ }).click();
    await expect(dialog.getByRole("heading", { name: "Getting LiDAR from ELVIS" })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await dialog.getByRole("button", { name: "Back to the form" }).click();

    await dialog.getByRole("button", { name: "How this topo is drawn" }).click();
    await expect(dialog.getByRole("radio", { name: "Hillshade" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // The band table and the layer checkboxes are the dense ones.
    await dialog.getByRole("radio", { name: "Slope" }).click();
    await expect(dialog.getByRole("textbox", { name: /upper angle/ }).first()).toBeVisible();
    await expectNoViolations(page, "dialog");

    await dialog.getByRole("radio", { name: "Auto-export" }).click();
    await expect(dialog.getByRole("radiogroup", { name: "Format" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    await dialog.getByRole("button", { name: "Back to the form" }).click();
    await expect(dialog.getByRole("heading", { name: "Make a LiDAR topo" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("Make a GeoPDF, its template mode and its dense extent grid", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Maps", exact: true }).click();
    const aside = page.locator("aside");
    await aside.getByRole("radio", { name: "GeoPDFs" }).click();
    await aside.getByRole("button", { name: /^Make/ }).first().click();
    await page.getByRole("menuitem", { name: "Make a GeoPDF" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("heading", { name: "Make a GeoPDF" })).toBeVisible();
    // The four edges, the pivot radiogroup and six rails in one scrolling body.
    await expect(dialog.getByRole("radiogroup", { name: "Pivot" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Custom paper reveals the ratio and takes orientation away from the user.
    await dialog.getByRole("radio", { name: "Custom" }).click();
    await expect(dialog.getByRole("textbox", { name: "Ratio width" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Naming a template swaps the pinned line for a field, Save and Cancel.
    await dialog.getByRole("radio", { name: "A4" }).click();
    await dialog.getByRole("button", { name: "Save as a template" }).click();
    await expect(dialog.getByRole("textbox", { name: "Template name" })).toBeFocused();
    await expectNoViolations(page, "dialog");
    await dialog.getByRole("button", { name: "Cancel" }).first().click();

    // Picking a paper size is real work, so leaving asks before it goes.
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", { name: "Discard unsaved changes?" });
    await expect(confirm).toBeVisible();
    await expectNoViolations(page, "[role='alertdialog']");
    await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("the importer: the drop zone, the column map and the confirm", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await page.getByRole("button", { name: /^Add/ }).first().click();
    await page.getByRole("menuitem", { name: "Import from file" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("heading", { name: "Import data" })).toBeVisible();
    // Nothing dropped yet: the zone is a real <button>, not a div with a click.
    await expect(dialog.getByRole("button", { name: /^Drop a CSV here/ })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // The file goes through the hidden input the zone drives, which is the same
    // path a click-to-browse takes. The fixture is synthetic (`__fixtures__`).
    await dialog
      .locator("input[type=file]")
      .setInputFiles(new URL("./__fixtures__/places-sample.csv", import.meta.url).pathname);
    await expect(dialog.getByRole("heading", { name: /^Place columns/ })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "dialog");

    // Every row here is new, so the REVIEW step is skipped rather than shown
    // empty: a page with no decisions on it is a click asking the user to agree
    // that there was nothing to do (DESIGN.md §1).
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Confirm import" })).toBeVisible();
    await expect(dialog).toContainText("3 place rows ready to import");
    await expectNoViolations(page, "dialog");

    // The merge policy is a row that opens a SUB-VIEW, never an accordion
    // (DESIGN.md §6); its eight switches are named by the field each decides.
    await dialog.getByRole("button", { name: /^Merge settings/ }).click();
    await expect(dialog.getByRole("heading", { name: "Merge settings" })).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "V grade" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Escape backs out of the sub-view, not out of the dialog — and nothing is
    // imported: this case never presses Import, so it writes no places.
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("heading", { name: "Confirm import" })).toBeVisible();
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

  test("a form dialog filling the phone's screen", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const sheet = page.getByRole("complementary", { name: "Places" });
    await expect(sheet.locator("[data-place-id]").first()).toBeVisible({ timeout: 15_000 });

    // `size="large"` fills a narrow screen from the kit's own CSS — a different
    // rule from the centred desktop dialog, and one axe had never walked.
    await sheet.getByRole("button", { name: "Claustral Canyon", exact: true }).click();
    // The sheet is named after the page it holds, so opening a place RENAMES the
    // landmark — hold it by role from here, not by the name it used to have.
    const page_ = page.locator("aside");
    await expect(page.getByRole("complementary", { name: "Claustral Canyon" })).toBeVisible();
    await page_.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit place" }).click();
    const form = page.getByRole("dialog", { name: "Edit place" });
    await expect(form).toBeVisible();
    await expectNoViolations(page, "dialog");

    // It really is full-bleed here, rather than a desktop dialog squeezed.
    const box = (await form.boundingBox())!;
    expect(box.width).toBe(390);
    await page.keyboard.press("Escape");
  });

  test("the bottom sheet is a named landmark whose height the keyboard sets", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();

    // The same complementary landmark the desktop panel is, named by its page:
    // a reader jumping by landmark should not lose the panel on a phone.
    const sheet = page.getByRole("complementary", { name: "Places" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator("[data-place-id]").first()).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    // The grab bar answers the arrows, or "full" is a height only a pointer can
    // ask for. Asserted through the sheet's own geometry, because a slider that
    // relabels itself without moving anything is the failure worth catching.
    const height = page.getByRole("slider", { name: "Panel height" });
    await height.focus();
    await expect(height).toHaveAttribute("aria-valuetext", "Half height");
    const topAt = async () => (await sheet.boundingBox())!.y;
    const half = await topAt();

    await page.keyboard.press("ArrowUp");
    await expect(height).toHaveAttribute("aria-valuetext", "Full height");
    await expect.poll(topAt).toBeLessThan(half);

    // It clamps rather than wrapping: the tallest is the end of the road.
    await page.keyboard.press("ArrowUp");
    await expect(height).toHaveAttribute("aria-valuetext", "Full height");

    await page.keyboard.press("Home");
    await expect(height).toHaveAttribute("aria-valuetext", "Peek");
    await expect.poll(topAt).toBeGreaterThan(half);
  });
});
