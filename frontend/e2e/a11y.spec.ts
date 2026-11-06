import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Automated accessibility checks for the redesigned surfaces of Logjam Web: the
// shell (rail, map chrome), Places with its filter sheet, the Layers popover and
// the narrow-web tab bar. axe finds roughly a third of WCAG failures — contrast,
// names, roles, landmarks — so this is a floor, not a verdict; keyboard order and
// focus return are checked by hand (frontend/DESIGN.md).
//
// Local only: it needs fake auth and a seeded API, and prod smoke stays
// auth-free (frontend/AGENTS.md).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);

/** The second local server (playwright.config.ts), with NO fake auth. */
const SIGN_IN_URL = process.env.E2E_SIGN_IN_URL ?? "http://localhost:5199";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * A surface is measured once it has finished ARRIVING.
 *
 * `Dialog` fades itself in (`@starting-style`, DESIGN.md), and axe computes
 * contrast from what is PAINTED — so a check running while the dialog is
 * half-way there measures its colours composited against the page behind it
 * and reports both a shade light. That is not hypothetical: it failed
 * `textMuted` on `secondary` at 4.23:1, a pair that measures a passing 4.60:1
 * once the dialog has landed. It only shows up at all because that pair ships
 * with 0.10 of margin (`scripts/wcag-contrast.mjs`), which is worth knowing
 * on its own — anything translucent over a card's caption is under AA.
 */
async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("dialog[open]")].every(
        (dialog) => Number(getComputedStyle(dialog).opacity) === 1,
      ) &&
      // A button's 150 ms background-color transition, or the Tools tray
      // folding out, otherwise lets axe read a half-way colour.
      document
        .getAnimations()
        .every(
          (a) =>
            !(a instanceof CSSTransition || a instanceof CSSAnimation) ||
            a.playState !== "running",
        ),
  );
}

async function expectNoViolations(page: Page, include?: string) {
  await settled(page);
  // MapLibre writes the map's credits once the style's sources have loaded,
  // well after the canvas is up. A run before then measures a box with no
  // links in it, which is how their missing underline passed.
  if (include === "#map") {
    await expect(
      page.locator("#map .maplibregl-ctrl-attrib a").first(),
    ).toBeAttached({ timeout: 15_000 });
  }
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
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
}

/** The seed's announcement (api/prisma/seed.ts), marked read here so opening it
 *  writes nothing to the account. */
const SEEDED_ANNOUNCEMENT = "Logjam is moving to a new server";

async function withAnnouncementRead(page: Page) {
  await page.route("**/notifications", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const rows: { type: string }[] = await response.json();
    await route.fulfill({
      response,
      json: rows.map((row) =>
        row.type === "announcement" ? { ...row, read: true } : row,
      ),
    });
  });
}

async function openAnnouncement(page: Page, narrow = false) {
  if (narrow) {
    // Narrow web keeps the Inbox in the tab bar's More menu.
    await page.getByRole("button", { name: /^More/ }).click();
    await page.getByRole("menuitem", { name: /^Inbox/ }).click();
  } else {
    await page.getByRole("button", { name: /^Inbox/ }).click();
  }
  await page
    .locator("aside")
    .getByRole("button", { name: SEEDED_ANNOUNCEMENT, exact: true })
    .click({ timeout: 15_000 });
  const dialog = page.getByRole("dialog", { name: SEEDED_ANNOUNCEMENT });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the shell: rail and map chrome", async ({ page }) => {
    await openApp(page);
    await expectNoViolations(page, "nav[aria-label='Pages']");
    await expectNoViolations(page, "#map");
  });

  test("Tab shows a ring on each stop, forced colours keep it, and reduced motion stills transitions", async ({
    page,
  }) => {
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await openApp(page);
    // Every stop through the rail and the chrome draws an outline: a ring that
    // is a box-shadow, or nothing, is gone under forced colours.
    const missing: string[] = [];
    for (let stop = 0; stop < 12; stop++) {
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const draws = (node: Element) => {
          const style = getComputedStyle(node);
          return (
            style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
          );
        };
        const name = el.getAttribute("aria-label") ?? el.tagName;
        if (draws(el)) return { name, drawn: true };
        // A stop may draw its ring on the card or field around it, but only
        // WHILE focused: an outline an ancestor carries anyway is not it.
        const around = [el.parentElement, el.parentElement?.parentElement];
        const lit = around.filter(
          (node): node is HTMLElement => !!node && draws(node),
        );
        el.blur();
        const drawnByFocus = lit.some((node) => !draws(node));
        el.focus();
        return { name, drawn: drawnByFocus };
      });
      if (ring && !ring.drawn) missing.push(ring.name);
    }
    expect(missing).toEqual([]);

    // The global rule is what stills them: with motion allowed the same buttons
    // transition, so removing the rule fails the second check.
    const longestTransition = () =>
      page.evaluate(() =>
        Math.max(
          ...[...document.querySelectorAll("button")].map((el) =>
            Math.max(
              ...getComputedStyle(el)
                .transitionDuration.split(",")
                .map(
                  (d) => parseFloat(d) * (d.trim().endsWith("ms") ? 1 : 1000),
                ),
            ),
          ),
        ),
      );
    expect(await longestTransition()).toBeLessThan(1);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await longestTransition()).toBeGreaterThan(50);
  });

  test("Friends, a request, the sharing audit and the share dialog", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Friends", exact: true }).click();
    const aside = page.locator("aside");
    // A request carries its verbs on the card's own footer; a friend carries a ⋯.
    await expect(aside.getByRole("button", { name: "Accept" })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");

    // Adding someone is a dialog, not a box above the list.
    await aside
      .getByRole("button", { name: "Add friend", exact: true })
      .click();
    const addDialog = page.locator("dialog[open]");
    await expect(
      addDialog.getByRole("searchbox", { name: "Search by username" }),
    ).toBeFocused();
    await addDialog.getByRole("searchbox").fill("car");
    await expect(
      addDialog.getByRole("button", { name: "Add", exact: true }),
    ).toBeVisible();
    // The invite link sits under the search. Seen, never pressed: minting one
    // would write to the account.
    await expect(
      addDialog.getByRole("button", { name: "Copy invite link" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(addDialog).toHaveCount(0);

    // The audit replaces the list: a hero with a way back, a direction rail and
    // one row per shared thing, of every kind.
    await aside.getByRole("button", { name: "bob", exact: true }).click();
    await expect(
      aside.getByRole("radio", { name: /^You share/ }),
    ).toBeVisible();
    await expect(
      aside.getByRole("button", { name: "Stop sharing" }).first(),
    ).toBeVisible();
    await expectNoViolations(page, "aside");

    await aside.getByRole("radio", { name: /^They share/ }).click();
    await expectNoViolations(page, "aside");

    // Selecting swaps the rail for the bar at the same height, and the bulk
    // confirm names the blast radius rather than asking "sure?".
    await aside.getByRole("radio", { name: /^You share/ }).click();
    await aside.getByRole("checkbox").first().click();
    await expect(aside.getByRole("group", { name: "Selection" })).toBeVisible();
    await expectNoViolations(page, "aside");

    await aside.getByRole("button", { name: /^Stop sharing 1 with/ }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expectNoViolations(page, "[role='alertdialog']");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel" })
      .click();
    // Escape clears the selection, as it does on every other list.
    await page.keyboard.press("Escape");
    await expect(aside.getByRole("group", { name: "Selection" })).toHaveCount(
      0,
    );
    // One layer per press: the selection went, the page did not.
    // Mutation: drop the `defaultPrevented` guard in `useEscape`.
    await expect(
      aside.getByRole("radio", { name: /^You share/ }),
    ).toBeVisible();
  });

  test("Plans: the list, a plan's page and its views", async ({ page }) => {
    await openApp(page);
    const aside = page.locator("aside");
    await page.getByRole("button", { name: /^Plans/ }).click();
    await expect(aside.getByRole("radio", { name: /^Upcoming/ })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");

    // The one form for a plan's name, dates and types. Seen, never sent.
    await aside.getByRole("button", { name: "New plan" }).first().click();
    const newPlan = page.locator("dialog[open]");
    await expect(newPlan.getByRole("textbox", { name: "Name" })).toBeFocused();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(newPlan).toHaveCount(0);

    // The seeded plan alice leads: hero verbs by role, then four views.
    await aside
      .getByRole("button", { name: "Wollangambe weekend", exact: true })
      .click();
    await expect(aside.getByRole("radio", { name: /^Write-up/ })).toBeVisible();
    await expectNoViolations(page, "aside");

    // A section's form: its title takes focus; seen, never sent.
    await aside.getByRole("button", { name: "Add", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Add a write-up section" })
      .click();
    const section = page.locator("dialog[open]");
    await expect(section.getByRole("textbox", { name: "Title" })).toBeFocused();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(section).toHaveCount(0);
    for (const view of [/^Map/, /^Forms/, /^People/]) {
      await aside.getByRole("radio", { name: view }).click();
      await expectNoViolations(page, "aside");
    }

    // Invite people: the search and the link, before anything is sent.
    await aside.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Invite people" }).click();
    const back = aside.getByRole("button", { name: "Back to people" });
    await expect(back).toBeFocused();
    await expectNoViolations(page, "aside");
    await back.click();
    await expect(
      aside.getByRole("button", { name: "Invite people" }),
    ).toBeFocused();
    await aside.getByRole("button", { name: "Plan actions" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");

    // Print a summary: what goes in, before the browser's print dialog.
    await page.getByRole("menuitem", { name: "Print a summary" }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expectNoViolations(page, "dialog");
    // While it is open, only the summary prints; once it closes, Logjam Web
    // prints as it did. Mutation: drop the `:has(> #plan-print)` scope in
    // PlanSummary.module.css, and every other print is a blank sheet.
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#plan-print")).toBeVisible();
    await expect(page.locator("#root")).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await page.keyboard.press("Escape");
    await expect(page.locator("#plan-print")).toHaveCount(0);
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("#root")).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    // A plan carol invited alice to: its preview, before Join or Decline.
    // Join joins at once, so the test stops at the preview.
    await aside.getByRole("button", { name: "Back to plans" }).click();
    await aside
      .getByRole("button", { name: "Kanangra Walls loop", exact: true })
      .click();
    await expect(aside.getByRole("button", { name: "Decline" })).toBeVisible();
    await expectNoViolations(page, "aside");
  });

  test("Plans forms: a form's page, answering it, and the builder", async ({
    page,
  }) => {
    await openApp(page);
    const aside = page.locator("aside");
    await page.getByRole("button", { name: /^Plans/ }).click();
    await aside
      .getByRole("button", { name: "Wollangambe weekend", exact: true })
      .click();
    await aside.getByRole("radio", { name: /^Forms/ }).click();
    // The seeded Safety contacts form: who sees answers first, then the table.
    await aside
      .getByRole("button", { name: "Safety contacts", exact: true })
      .click();
    await expect(
      aside.getByRole("region", { name: "Answers" }).getByRole("table"),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    // Answering, seen and never sent.
    await aside
      .getByRole("button", { name: /^(Answer|Change my answer)$/ })
      .click();
    await expect(page.locator("dialog[open]")).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");

    // The builder starts from a preset.
    await aside.getByRole("button", { name: "Back to the plan" }).click();
    await aside.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add a form" }).click();
    const builder = page.locator("dialog[open]");
    await expectNoViolations(page, "dialog");
    await builder.getByRole("button", { name: "Gear to borrow" }).click();
    await expect(builder.getByRole("textbox", { name: "Title" })).toBeVisible();
    await expectNoViolations(page, "dialog");
  });

  test("Plans items: the plan's things, their ⋯ and Add a copy", async ({
    page,
  }) => {
    // Save a copy is offered only on what someone else added, and the seed's
    // places are alice's own: the first loses its adder (an account gone).
    await page.route(/\/plans\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const plan = await response.json();
      plan.places = plan.places.map((each: object, at: number) =>
        at === 0 ? { ...each, addedBy: null } : each,
      );
      await route.fulfill({ response, json: plan });
    });
    await openApp(page);
    const aside = page.locator("aside");
    await page.getByRole("button", { name: /^Plans/ }).click();
    await aside
      .getByRole("button", { name: "Wollangambe weekend", exact: true })
      .click();
    await aside.getByRole("radio", { name: /^Map/ }).click();
    const place = "Wollangambe meeting point";
    await expect(
      aside.getByRole("button", { name: place, exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");

    // A place's ⋯, its Edit and its Save a copy: seen, never sent.
    const actions = aside.getByRole("button", { name: `Actions for ${place}` });
    await actions.click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.locator("dialog[open]");
    await expect(
      dialog.getByRole("textbox", { name: "Name", exact: true }),
    ).toBeFocused();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await actions.click();
    await page.getByRole("menuitem", { name: "Save a copy" }).click();
    await expect(dialog).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Add a copy: alice's own places and ways, ticked and priced.
    await aside.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add a place or way" }).click();
    await expect(dialog.getByRole("radio", { name: /^Places/ })).toBeVisible();
    await dialog.getByRole("checkbox").first().check();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("Plans on the map: the plan bar, and Start a trip log's places", async ({
    page,
  }) => {
    // The plan's trip, already over: Start a trip log then asks which of its
    // places the trip links. Only the dates are rewritten.
    await page.route(/\/plans\/[0-9a-f-]{36}$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const plan = await response.json();
      await route.fulfill({
        response,
        json: { ...plan, startDate: "2026-01-03", endDate: "2026-01-04" },
      });
    });
    await openApp(page);
    const aside = page.locator("aside");
    await page.getByRole("button", { name: /^Plans/ }).click();
    await aside
      .getByRole("button", { name: "Wollangambe weekend", exact: true })
      .click();

    // While a plan is open the map shows it, and says so.
    const backToMap = page.getByRole("button", { name: "Back to my map" });
    await expect(backToMap).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("main")).toContainText(
      "Plan: Wollangambe weekend",
    );
    await expectNoViolations(page, "main");

    // The page's notice asks for Safety contacts first; the verb is in ⋯.
    await aside.getByRole("button", { name: "Plan actions" }).click();
    await page
      .getByRole("menuitem", { name: "Log a trip from this plan" })
      .click();
    const dialog = page.locator("dialog[open]");
    await expect(
      dialog.getByRole("checkbox", { name: "Wollangambe meeting point" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Back to my map: the plan closes and the user's own map returns.
    await backToMap.click();
    await expect(backToMap).toHaveCount(0);
  });

  test("the leaderboard button on Friends, and the Leaderboard page", async ({
    page,
  }) => {
    // The seed has alice on the leaderboard; the board itself is a made-up one
    // that draws every section, a podium, medals and a nudge, which no seed
    // date could promise (a podium shows one week a year).
    await page.route("**/friends/leaderboard", (route) =>
      route.fulfill({
        status: 200,
        json: {
          joined: true,
          season: "2026–27",
          entries: [
            {
              userId: "b",
              username: "bob",
              canyonCount: 6,
              rank: 1,
              isSelf: false,
            },
            {
              userId: "a",
              username: "alice",
              canyonCount: 4,
              rank: 2,
              isSelf: true,
            },
            {
              userId: "c",
              username: "carol",
              canyonCount: 1,
              rank: 3,
              isSelf: false,
            },
          ],
          notJoined: ["dave"],
          podium: { season: "2025–26", rank: 2, canyonCount: 9 },
        },
      }),
    );
    await openApp(page);
    await page.getByRole("button", { name: "Friends", exact: true }).click();
    const aside = page.locator("aside");
    const button = aside.getByRole("button", {
      name: "Leaderboard, you're #2 of 3",
    });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    // It replaces the list, with a way back. Dismiss is not pressed: the case
    // only looks.
    await button.click();
    await expect(
      aside.getByRole("heading", { level: 2, name: "Leaderboard" }),
    ).toBeVisible();
    await expect(aside.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expectNoViolations(page, "aside");

    // The rules open in a dialog, and Escape puts focus back on their button.
    const rules = aside.getByRole("button", { name: "How it works" });
    await rules.click();
    await expect(
      page.getByRole("dialog", { name: "How it works" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(rules).toBeFocused();

    await aside.getByRole("button", { name: "Back to friends" }).click();
    await expect(button).toBeVisible();
  });

  test("Account, Settings and the three lists it keeps", async ({ page }) => {
    await openApp(page);
    const aside = page.locator("aside");

    // Account leads with who you are and the two quota meters.
    await page.getByRole("button", { name: "Account", exact: true }).click();
    await expect(
      aside.getByRole("button", { name: "Change username" }),
    ).toBeVisible({
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
    await expect(
      aside.getByRole("radiogroup", { name: "Theme" }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");

    // A list opens in place, with the arrow back out (DESIGN.md).
    await aside.getByRole("button", { name: /^Place types/ }).click();
    await expect(
      aside.getByRole("heading", { name: "Place types" }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");

    // Its editor is a DIALOG, like every other create in the app, and its form
    // is the icon grid and the swatch line, both radio groups.
    await aside
      .getByRole("button", { name: "Add a place type" })
      .first()
      .click();
    const typeDialog = page.locator("dialog[open]");
    await expect(
      typeDialog.getByRole("radiogroup", { name: "Icon" }),
    ).toBeVisible();
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
    await expect(
      aside.getByRole("heading", { name: /Built in/ }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");

    // A row opens the same dialog on an existing one, with the type fixed.
    await aside
      .getByRole("button", { name: /^Access beta/ })
      .first()
      .click();
    const attrDialog = page.locator("dialog[open]");
    // The type is a FACT on an existing attribute, not a control that cannot
    // be operated: no picker, and the shape it already stores in words.
    await expect(
      attrDialog.getByRole("radiogroup", { name: "Type" }),
    ).toHaveCount(0);
    await expect(attrDialog.getByText("Text", { exact: true })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
  });

  test("Places, its filter sheet and a row menu", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const aside = page.locator("aside");
    await expect(aside.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });

    // NARROW THE LIST BEFORE WALKING IT. axe is per-element, and this account
    // holds 311 places whose rows are one component repeated — so the walk
    // answers the same question 311 times and charges 7.4s for it against 0.17s
    // for two rows, with an identical result. Three walks of that put the case
    // at 51.7s alone and over the 60s cap under any parallel load. Everything
    // the case is about survives the search: the hero, the type rail, the
    // sort-and-filter button, a row and its menu.
    await aside.getByRole("searchbox").first().fill("claustral");
    await expect(aside.getByRole("radio", { name: /^All/ })).toBeVisible();
    await expect
      .poll(() => aside.locator("[data-place-id]").count())
      .toBeLessThan(10);
    await expectNoViolations(page, "aside");

    await page.getByRole("button", { name: /^Sort and filter/ }).click();
    await expect(
      page.getByRole("heading", { name: "Sort and filter" }),
    ).toBeFocused();
    await expectNoViolations(page, "aside");

    // The sheet's own ×, found through the sheet: the panel keeps its × beside
    // it (UX §3), and a place called "Closet" would add three more "Close"
    // substrings (its row, its ⋯).
    await page
      .getByRole("region", { name: "Sort and filter" })
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
  });

  test("a place's own page, its verbs and its form", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const list = page.locator("aside");
    await expect(list.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    await list
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();

    // The page leads with the place's name, and every attribute is stated once
    // — canyon scalars are not printed again by the loop over the type's
    // definitions.
    await expect(
      list.getByRole("heading", { level: 2, name: "Claustral Canyon" }),
    ).toBeVisible();
    await expect(list.getByText("Longest pitch", { exact: true })).toHaveCount(
      1,
    );
    await expectNoViolations(page, "aside");

    // The verbs are `placeVerbs`: a menu, not a footer of buttons.
    await list.getByRole("button", { name: /^Actions for / }).click();
    const menu = page.getByRole("menu");
    await expect(
      menu.getByRole("menuitem", { name: "Edit place" }),
    ).toBeVisible();
    await expectNoViolations(page, "[role='menu']");

    // The grades are rails now, drawn from their definitions' bounds.
    await menu.getByRole("menuitem", { name: "Edit place" }).click();
    const form = page.getByRole("dialog", { name: "Edit place" });
    await expect(
      form.getByRole("radiogroup", { name: "V grade" }),
    ).toBeVisible();
    await expect(form.getByRole("radiogroup", { name: "Type" })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
  });

  test("a place's Add a way dialog: its sources and a route list", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const list = page.locator("aside");
    await list
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();
    await list
      .getByRole("button", { name: /^(Add a way|Replace this place's route)$/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add a way" });
    await expectNoViolations(page, "dialog");

    // A source opens a sub-view; Escape undoes that one layer, then the dialog.
    await dialog
      .getByRole("button", { name: /^Choose a route you drew/ })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Choose a route you drew" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("a selection of places, and what can be done with it", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const list = page.locator("aside");
    await expect(list.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });

    // The tile IS the checkbox (DESIGN.md), and the bar replaces the rail.
    await list.getByRole("checkbox").first().click();
    await list.getByRole("button", { name: "Share", exact: true }).click();

    const dialog = page.getByRole("dialog", { name: /^Share \d+ place/ });
    await expect(dialog).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The destructive verb is the bar's, and it confirms, saying what goes and
    // what stays.
    await list.getByRole("button", { name: "Delete", exact: true }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("stay, unlinked");
    await expectNoViolations(page, "[role='alertdialog']");
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
  });

  test("the Inbox, a row menu and a selection", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    const inbox = page.locator("aside");
    await expect(inbox.getByRole("checkbox").first()).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");

    await inbox
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
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

  test("a maintainer announcement opened from its row", async ({ page }) => {
    await withAnnouncementRead(page);
    await openApp(page);
    const dialog = await openAnnouncement(page);
    await expect(dialog.getByRole("heading", { level: 2 })).toBeFocused();
    // The seed's #, ## and ### sit under the dialog's title, none skipped.
    for (const [level, name] of [
      [3, "What to expect"],
      [4, "If something looks wrong"],
      [5, "On Logjam GPS"],
    ] as const)
      await expect(dialog.getByRole("heading", { level, name })).toBeVisible();
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("a confirm dialog", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Inbox/ }).click();
    const rowMenu = page
      .locator("aside")
      .getByRole("button", { name: /^Actions for / })
      .first();
    await expect(rowMenu).toBeVisible({ timeout: 15_000 });
    await rowMenu.click();
    await page.getByRole("menuitem", { name: "Delete notification" }).click();

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
    // The kit dialog (`Dialog`, a native <dialog>), so the confirm stands over
    // one of our own.
    const form = page.getByRole("dialog", { name: "Add a place" });
    await expect(form).toBeVisible();
    await form.getByLabel(/^Name/).first().fill("Unsaved name");

    // The Escape that asks the form to close raises the confirm, and must not
    // also be the close request that dismisses it.
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", {
      name: "Discard this place?",
    });
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

  test("Trips, a trip, its form, and Stats", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Trips", exact: true }).click();
    const aside = page.locator("aside");
    await expect(
      aside.getByRole("heading", { level: 2, name: "Trips", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    // A trip is READ on its own PAGE, not in a dialog (DESIGN.md).
    const rowMenu = aside
      .getByRole("button", { name: /^Actions for / })
      .first();
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

    // Back to the logbook, where Stats opens from the hero.
    await aside.getByRole("button", { name: "Back to Trips" }).click();
    await aside.getByRole("button", { name: "Trip stats" }).click();
    await expect(
      aside.getByRole("heading", { level: 2, name: /out$/ }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");
  });

  test("Ways, a row menu, a route and the draw tool", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Ways", exact: true }).click();
    const aside = page.locator("aside");
    await expect(
      aside.getByRole("heading", { level: 2, name: "Ways", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "aside");

    const rowMenu = aside
      .getByRole("button", { name: /^Actions for / })
      .first();
    await rowMenu.click();
    await expect(page.getByRole("menu")).toBeVisible();
    // Reverse is a button in the draw tool now, never a menu item: it changes
    // the geometry on screen, so it belongs beside the other edits to it.
    await expect(
      page.getByRole("menuitem", { name: "Reverse direction" }),
    ).toHaveCount(0);
    await expectNoViolations(page, "[role='menu']");
    await page.keyboard.press("Escape");

    // A file is sent as a copy: a friend picker that waits for its button.
    // Opened and closed only — nothing is sent.
    await aside
      .locator("[data-way-kind='track']")
      .first()
      .getByRole("button", { name: /^Actions for/ })
      .click();
    await page.getByRole("menuitem", { name: "Send a copy" }).click();
    const sendDialog = page.locator("dialog[open]");
    await expect(
      sendDialog.getByRole("button", { name: "Send a copy" }),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoViolations(page, "dialog");
    await page.keyboard.press("Escape");
    await expect(sendDialog).toHaveCount(0);

    // The recording's own page was under that dialog: its two charts, drawn
    // from the seeded file. The newest track is a recording, so it has both.
    await expect(
      aside.getByRole("img", { name: /^Elevation profile: / }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      aside.getByRole("img", { name: /^Speed profile: / }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");
    await aside.getByRole("button", { name: /^Back/ }).click();

    // A route's own page: its stats, its colour picker and its place link.
    // Opened through the row's own menu: `Row`'s stretched open button is named
    // after the row's title, which is a route name we cannot know here.
    await aside
      .locator("[data-way-kind='route']")
      .first()
      .getByRole("button", { name: /^Actions for/ })
      .click();
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
    await expect(
      aside.getByRole("heading", { level: 2, name: "New route" }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");
    await aside.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("Layers → Terrain → Sharpened areas, and a row menu", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    const popover = page.getByRole("dialog", { name: "Sharpened areas" });
    await page
      .getByRole("dialog", { name: "Map layers" })
      .getByRole("radio", { name: "Terrain" })
      .click();
    await page.getByRole("button", { name: /^Sharpened areas/ }).click();
    await expect(popover).toBeVisible();
    await expectNoViolations(
      page,
      "[role='dialog'][aria-label='Sharpened areas']",
    );

    // The seed always has completed sharpened jobs, so there is always a row menu.
    await popover
      .getByRole("button", { name: /^Actions for / })
      .first()
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
    await page.keyboard.press("Escape");
  });

  test("Sharpen an area, its ELVIS steps and its Vegetation choice", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Map layers" })
      .getByRole("radio", { name: "Terrain" })
      .click();
    await page.getByRole("button", { name: /^Sharpened areas/ }).click();
    await page.getByRole("button", { name: "Sharpen an area" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(
      dialog.getByRole("heading", { name: "Sharpen an area" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");

    // The errand is a SUB-VIEW: it swaps the body and backs out to the form.
    await dialog.getByRole("button", { name: /^Haven.t got one/ }).click();
    await expect(
      dialog.getByRole("heading", { name: "Getting LiDAR from ELVIS" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");
    await dialog.getByRole("button", { name: "Back to the form" }).click();

    // A ZIP with point clouds offers Vegetation. The fixture is made up: one
    // empty .laz under an ELVIS-style name, read only for its file list.
    await dialog
      .locator("input[type=file]")
      .setInputFiles(
        new URL("./__fixtures__/elvis-point-clouds.zip", import.meta.url)
          .pathname,
      );
    const vegetation = dialog.getByRole("checkbox", {
      name: /Vegetation \(experimental\)/,
    });
    await expect(vegetation).toBeVisible();
    await expectNoViolations(page, "dialog");
    await vegetation.check();
    await expectNoViolations(page, "dialog");

    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", {
      name: "Discard this request?",
    });
    await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("Make a map: GeoPDF, its edges, and a GIS format", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("group", { name: "Tools" })
      .getByText("Make a map")
      .click();

    const dialog = page.locator("dialog[open]");
    await expect(
      dialog.getByRole("heading", { name: "Make a map" }),
    ).toBeVisible();
    // Closed, the Area section is paper, scale and the two ways to set the area.
    await expect(
      dialog.getByRole("button", { name: "Pick on the map" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Type the coordinates opens the four edges under the Area row.
    await dialog.getByRole("button", { name: "Type the coordinates" }).click();
    await expect(dialog.getByRole("textbox", { name: "North" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Other opens the typed scale under the presets.
    await dialog.getByRole("radio", { name: "Other" }).click();
    await expect(dialog.getByRole("textbox", { name: "Scale" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Custom paper reveals the ratio and takes orientation away from the user.
    await dialog.getByRole("radio", { name: "Custom" }).click();
    await expect(
      dialog.getByRole("textbox", { name: "Ratio width" }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");

    await dialog.getByRole("radio", { name: "A4" }).click();

    // A GIS format swaps the paper for a free box, its edges and the
    // format's layers.
    await dialog.getByRole("radio", { name: "GeoTIFF" }).click();
    await expect(dialog.getByRole("button", { name: "Heights" })).toBeVisible();
    await dialog.getByRole("button", { name: "Type the coordinates" }).click();
    await expect(dialog.getByRole("textbox", { name: "North" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Picking a paper size is real work, so leaving asks before it goes.
    await page.keyboard.press("Escape");
    const confirm = page.getByRole("alertdialog", {
      name: "Discard this map?",
    });
    await expect(confirm).toBeVisible();
    await expectNoViolations(page, "[role='alertdialog']");
    await confirm.getByRole("button", { name: "Discard" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("the importer: the drop zone, the column map and the confirm", async ({
    page,
  }) => {
    // Merge settings appear only when a row matches a place you have, and the
    // seed has none of the fixture's names: the list gains one, read-only.
    await page.route("**/places", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const places: { id: string; name: string }[] = await response.json();
      await route.fulfill({
        response,
        json: [
          ...places,
          {
            ...places[0],
            id: "00000000-0000-4000-8000-00000000a11a",
            name: "Test Alpha Gorge",
            latitude: -33.7101,
            longitude: 150.3102,
          },
        ],
      });
    });
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await page.getByRole("button", { name: /^Add/ }).first().click();
    await page.getByRole("menuitem", { name: "Import from CSV" }).click();

    const dialog = page.locator("dialog[open]");
    await expect(
      dialog.getByRole("heading", { name: "Import from CSV" }),
    ).toBeVisible();
    // Nothing dropped yet: the zone is a real <button>, not a div with a click.
    await expect(
      dialog.getByRole("button", { name: /^Drop a CSV here/ }),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");

    // The file goes through the hidden input the zone drives, which is the same
    // path a click-to-browse takes. The fixture is synthetic (`__fixtures__`).
    await dialog
      .locator("input[type=file]")
      .setInputFiles(
        new URL("./__fixtures__/places-sample.csv", import.meta.url).pathname,
      );
    await expect(
      dialog.getByRole("heading", { name: /^Place columns/ }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "dialog");

    // Every row here is new, so the REVIEW step is skipped rather than shown
    // empty: a page with no decisions on it is a click asking the user to agree
    // that there was nothing to do (shared/DESIGN.md §2).
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Confirm import" }),
    ).toBeVisible();
    await expect(dialog).toContainText("3 place rows ready to import");
    await expectNoViolations(page, "dialog");

    // The merge policy is a row that opens a SUB-VIEW, never an accordion
    // (DESIGN.md); its eight switches are named by the field each decides.
    await dialog.getByRole("button", { name: /^Merge settings/ }).click();
    await expect(
      dialog.getByRole("heading", { name: "Merge settings" }),
    ).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "V grade" })).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Escape backs out of the sub-view, not out of the dialog — and nothing is
    // imported: this case never presses Import, so it writes no places.
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("heading", { name: "Confirm import" }),
    ).toBeVisible();
  });

  test("the Layers popover", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Map layers" }),
    ).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Map layers']");
    await page
      .getByRole("dialog", { name: "Map layers" })
      .getByRole("radio", { name: /^Overlays/ })
      .click();
    await expectNoViolations(page, "[role='dialog'][aria-label='Map layers']");

    // Escape closes it and puts focus back on the button that opened it.
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Layers", exact: true }),
    ).toBeFocused();
  });

  // Stubbed: the gauge file is public and never fetched from prod here.
  test("a river gauge's panel", async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    await page.route("**/master/gauges/v1/latest.json", (route) =>
      route.fulfill({
        json: {
          version: 1,
          generatedAt: new Date().toISOString(),
          coldSweptAt: new Date().toISOString(),
          attribution: "Made-up readings. Real data: WaterNSW.",
          gauges: [
            {
              id: "212290",
              name: "COLO R @ UPPER COLO",
              lat: -33.8688,
              lon: 151.2093,
              hot: true,
              hasFlow: true,
              readings: [60, 40, 20, 0].map((m, i) => [
                now - m * 3600,
                1 + i / 10,
                40 + i,
              ]),
            },
          ],
        },
      }),
    );
    // Nothing but the gauge may sit under the pressed point.
    await page.route(
      /\/(places|routes)(\/shared|\/tracks)?(\?.*)?$/,
      (route) =>
        route.request().method() === "GET"
          ? route.fulfill({ json: [] })
          : route.continue(),
    );
    // Open on the gauge, past GAUGES_MIN_ZOOM: the start view (z7) draws none.
    await page.addInitScript(() => {
      localStorage.setItem("logjam.showGauges", "true");
      localStorage.setItem(
        "logjam.mapView",
        JSON.stringify({
          lat: -33.8688,
          lng: 151.2093,
          zoom: 9,
          bearing: 0,
          pitch: 0,
        }),
      );
    });
    await openApp(page);
    // The canvas is on screen before the map has loaded and its handlers are
    // attached; the zoom buttons are enabled once it has.
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const box = (await page.locator("canvas.maplibregl-canvas").boundingBox())!;
    const panel = page.getByRole("dialog", { name: "River gauge" });
    // The dot is drawn once the file has arrived, which nothing on the page
    // announces: press the gauge at the map's start view until the panel opens.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(panel).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    await expectNoViolations(page, "[role='dialog'][aria-label='River gauge']");

    // A press that closes a point panel only stops that click asking about a
    // new point: the gauge under it still opens.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    // Far enough left that the panel (about 300 px wide) stays clear of the
    // gauge in the middle.
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2, {
      button: "right",
    });
    const point = page.getByRole("dialog", { name: "This point" });
    await expect(point).toBeVisible();
    // Past the gauge's own re-press guard (GAUGE_RETAP_MS), which ignores a
    // press on the gauge whose panel Escape has just closed.
    await page.waitForTimeout(600);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(panel).toBeVisible();
    await expect(point).toHaveCount(0);

    // And a press on empty map closes the gauge panel and asks nothing new.
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.2);
    await expect(panel).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(point).toHaveCount(0);
  });

  test("the Layers popover's Terrain tab, and its slope bands", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Layers", exact: true }).click();
    const popover = page.getByRole("dialog", { name: "Map layers" });
    await popover.getByRole("radio", { name: "Terrain" }).click();
    await expect(
      popover.getByRole("switch", { name: "Show hillshade" }),
    ).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Map layers']");

    await popover.getByRole("button", { name: "Slope bands" }).click();
    const bands = page.getByRole("dialog", { name: "Slope bands" });
    await expect(
      bands.getByRole("button", { name: "Back to terrain" }),
    ).toBeVisible();
    await expectNoViolations(page, "[role='dialog'][aria-label='Slope bands']");
  });

  test("A right-click opens the point panel on Options; What is here? by Enter", async ({
    page,
  }) => {
    await openApp(page);
    // The canvas is on screen before the map has loaded and its handlers are
    // attached; the zoom buttons are enabled once it has.
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const canvas = page.locator("canvas.maplibregl-canvas");
    const box = (await canvas.boundingBox())!;
    // A right-click asks wherever it lands, so a seeded pin under the pointer
    // cannot swallow the press. It is the same panel a click opens, on Options,
    // so there is no facts view to go back to.
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5, {
      button: "right",
    });
    const hold = page.getByRole("dialog", { name: "This point" });
    await expect(hold).toBeVisible();
    for (const name of [
      "Draw a route from here",
      "Add a place here",
      "Measure from here",
    ])
      await expect(hold.getByRole("button", { name })).toBeVisible();
    await expect(hold.getByRole("button", { name: /^Back/ })).toHaveCount(0);
    await expectNoViolations(page, "[role='dialog'][aria-label='This point']");

    // Escape closes it, takes the dot with it and gives focus back to the map.
    await page.keyboard.press("Escape");
    await expect(hold).toHaveCount(0);
    await expect(page.locator(".maplibregl-marker")).toHaveCount(0);
    await expect(canvas).toBeFocused();

    // Reachable without a pointer: Enter on the focused map asks about the
    // middle of what is visible, and Tab walks the panel's own controls: the
    // coordinates copy where they are pressed, and Options holds the verbs.
    const panel = page.getByRole("dialog", { name: "This point" });
    // Where the panel and its dot are the first frame it is on screen, read in
    // the page before anything can settle it: the panel opens beside its dot,
    // never in the top left to jump there later.
    await page.evaluate(() => {
      const seen = window as unknown as { firstFrame?: unknown };
      const watch = new MutationObserver(() => {
        const element = document.querySelector(
          "[role='dialog'][aria-label='This point']",
        );
        if (!element) return;
        watch.disconnect();
        requestAnimationFrame(() => {
          const box = (target: Element | null) => {
            const rect = target?.getBoundingClientRect();
            return rect && { x: rect.x, y: rect.y, bottom: rect.bottom };
          };
          seen.firstFrame = {
            panel: box(element),
            dot: box(document.querySelector(".maplibregl-marker")),
          };
        });
      });
      watch.observe(document.body, { childList: true, subtree: true });
    });
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    const first = await page.waitForFunction(
      () => (window as unknown as { firstFrame?: unknown }).firstFrame,
    );
    const { panel: at, dot } = (await first.jsonValue()) as {
      panel: { x: number; y: number; bottom: number };
      dot: { x: number; y: number; bottom: number } | null;
    };
    expect(dot).not.toBeNull();
    // Beside the dot (8 px gap, clamped to the viewport), above or below it.
    expect(Math.abs(at.x - dot!.x)).toBeLessThanOrEqual(24);
    expect(
      Math.min(Math.abs(at.y - dot!.bottom), Math.abs(at.bottom - dot!.y)),
    ).toBeLessThanOrEqual(24);
    await expect(panel.getByRole("button", { name: "Close" })).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(
      panel.getByRole("button", { name: /^Position: .*\. Copy$/ }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Options" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByRole("button", { name: "Add a place here" }),
    ).toBeVisible();
  });

  test("What is here?: a press on the map closes the panel and asks nothing new", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const canvas = page.locator("canvas.maplibregl-canvas");
    const box = (await canvas.boundingBox())!;
    const panel = page.getByRole("dialog", { name: "This point" });
    // Empty map, away from the seeded pins at the left and from the panel.
    const press = () =>
      page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.2);
    await canvas.focus();
    await page.keyboard.press("Enter");
    await expect(panel).toBeVisible();
    await press();
    await expect(panel).toHaveCount(0);
    // Past the single-press delay a click that asked would have opened one.
    await page.waitForTimeout(600);
    await expect(panel).toHaveCount(0);
    // The next press is the map's again.
    await press();
    await expect(panel).toBeVisible();
  });

  test("Measure: armed from the Tools tray or a point, a page in the panel", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const aside = page.locator("aside");
    const canvas = page.locator("canvas.maplibregl-canvas");
    const tools = page.getByRole("button", { name: "Tools", exact: true });
    const tray = page.getByRole("group", { name: "Tools" });

    // Opening the tray leaves focus on its button: Escape closes it from there.
    await tools.click();
    await expect(tray).toBeVisible();
    await expectNoViolations(page, "[role='group'][aria-label='Tools']");
    await page.keyboard.press("Escape");
    await expect(tray).toHaveCount(0);
    await expect(tools).toBeFocused();

    // Closing fades EVERY pill (100 ms): sampled mid-way, none is at full
    // opacity. Mutation: put the fade back on the tray's container, or drop it.
    await tools.click();
    await expect(tray).toBeVisible();
    await page.waitForTimeout(400);
    const midFade = await page.evaluate(async () => {
      (
        document.querySelector("button[aria-label='Tools']") as HTMLElement
      ).click();
      await new Promise((resolve) => setTimeout(resolve, 45));
      return [
        ...document.querySelectorAll(
          "[role='group'][aria-label='Tools'] > button",
        ),
      ].map((item) => Number(getComputedStyle(item).opacity));
    });
    expect(midFade).toHaveLength(4);
    expect(midFade.every((opacity) => opacity < 0.95)).toBe(true);
    await expect(tray).toHaveCount(0);

    // A press on the map closes the tray and asks about no point.
    await tools.click();
    const mapBox = (await canvas.boundingBox())!;
    await page.mouse.click(
      mapBox.x + mapBox.width * 0.85,
      mapBox.y + mapBox.height * 0.2,
    );
    await expect(tray).toHaveCount(0);
    await page.waitForTimeout(600);
    await expect(page.getByRole("dialog", { name: "This point" })).toHaveCount(
      0,
    );

    await tools.click();
    await tray.getByRole("button", { name: "Measure distance" }).click();
    await expect(tray).toHaveCount(0);
    await expect(
      aside.getByRole("heading", { level: 2, name: "Measure distance" }),
    ).toBeVisible();
    const status = aside.getByRole("status");
    await expect(status).toHaveText("Click the map to measure");
    await expectNoViolations(page, "aside");

    // Without a pointer: Enter on the focused map places a point at the middle
    // of it, and the arrow keys move the map under that.
    await canvas.focus();
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("1 point");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(status).toHaveText("2 points");
    await expect(aside.locator("dd").first()).toHaveText(/\d (m|km)$/);
    await expectNoViolations(page, "aside");

    await aside
      .getByRole("button", { name: "Clear all points", exact: true })
      .click();
    await expect(status).toHaveText("Click the map to measure");

    // Nothing is kept, so leaving asks nothing.
    await aside.getByRole("button", { name: "Close" }).click();
    await expect(aside.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    // "Measure from here" on a point arms it with that point already placed.
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5, {
      button: "right",
    });
    await page
      .getByRole("dialog", { name: "This point" })
      .getByRole("button", { name: "Measure from here" })
      .click();
    await expect(
      aside.getByRole("heading", { level: 2, name: "Measure distance" }),
    ).toBeVisible();
    await expect(aside.getByRole("status")).toHaveText("1 point");

    // "Draw a route from here" arms the route tool, which opens as a page.
    await aside.getByRole("button", { name: "Close" }).click();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5, {
      button: "right",
    });
    await page
      .getByRole("dialog", { name: "This point" })
      .getByRole("button", { name: "Draw a route from here" })
      .click();
    await expect(
      aside.getByRole("heading", { level: 2, name: "New route" }),
    ).toBeVisible();
  });
});

/**
 * What the layout does when the window is small (a laptop at 150% or 200% zoom,
 * a phone). Nothing here is a contrast or a name, so axe cannot see it.
 */
test.describe("fits", () => {
  // Mutation: put the rail's `scrollIntoView` back in Chip.tsx and the form
  // opens scrolled to its rail.
  test("a long form opens at its title, not scrolled to its rail", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 700 });
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const aside = page.locator("aside");
    await expect(aside.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    await aside
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();
    await aside.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Edit place" }).click();
    const form = page.getByRole("dialog", { name: "Edit place" });
    await expect(form).toBeVisible();
    await expect(
      form.locator(":scope > div[id]").evaluate((body) => body.scrollTop),
    ).resolves.toBe(0);
  });

  // Mutation: remove the `max-height` block from NavRail.module.css and the
  // last item is cut off at 600px.
  test("the nav rail's last item fits a 150% zoom window", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 600 });
    await openApp(page);
    const rail = page.getByRole("navigation", { name: "Pages" });
    await expect(rail.getByRole("button", { name: "Settings" })).toBeInViewport(
      { ratio: 1 },
    );
  });

  // Mutation: remove the short-window branch of BottomSheet.tsx and the
  // sheet shows its hero, rail and about one row at 200% zoom.
  test("the phone sheet shows several rows at 200% zoom", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const rows = page
      .locator("aside, [role='region']")
      .locator("[data-place-id]");
    await expect(rows.nth(2)).toBeInViewport({ ratio: 1 });
  });

  // Mutation: drop `wrap` from the Scale rail and "Other" runs off the dialog.
  test("Make a map's Scale chips all show at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page
      .getByRole("group", { name: "Tools" })
      .getByText("Make a map")
      .click();
    const scale = page.getByRole("radiogroup", { name: "Scale" });
    await expect(scale.getByRole("radio", { name: "Other" })).toBeInViewport({
      ratio: 1,
    });
  });
});

/**
 * The keyboard's promises (frontend/DESIGN.md): a list is one tab stop, a page
 * is entered at its back arrow and left by Escape onto the row that opened it,
 * and Escape lifts an armed tool. axe cannot see any of it.
 */
test.describe("keyboard", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openPlaces(page: Page) {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const aside = page.locator("aside");
    await expect(aside.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    return aside;
  }

  // Mutation: drop `useListKeys` from `PanelBody` and every row is three tab
  // stops again.
  test("a list is one tab stop, moved by the arrow keys", async ({ page }) => {
    const aside = await openPlaces(page);
    const rows = aside.locator("[data-place-id]");
    expect(await rows.count()).toBeGreaterThan(10);

    const tabStops = await rows
      .first()
      .evaluate(
        (row) =>
          [
            ...(
              row.closest("[data-list]") as HTMLElement
            ).querySelectorAll<HTMLElement>("button, a[href], input"),
          ].filter(
            (el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled,
          ).length,
      );
    // The row's title, and the list's "Add a place" at its end.
    expect(tabStops).toBeLessThanOrEqual(2);

    const first = rows.nth(0).locator("[data-row-open]");
    const second = rows.nth(1).locator("[data-row-open]");
    await first.focus();
    await page.keyboard.press("ArrowDown");
    await expect(second).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(first).toBeFocused();

    // Tab leaves the list: not into the next row's tile or its ⋯.
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.closest("[data-row]")),
      )
      .toBeNull();
    await page.keyboard.press("Shift+Tab");
    await expect(first).toBeFocused();

    // Space ticks the tile, Shift+F10 opens the actions, Enter opens the page.
    await page.keyboard.press("Space");
    await expect(rows.nth(0).getByRole("checkbox")).toBeChecked();
    await page.keyboard.press("Space");
    await expect(rows.nth(0).getByRole("checkbox")).not.toBeChecked();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  // Mutation: draw a page's rows in a plain `div` instead of a `RowList` (drop
  // it from PlacesPanel) and that page has no list, so its case goes red.
  for (const panel of [
    "Places",
    "Trips",
    "Ways",
    "Plans",
    "Friends",
    "Inbox",
  ]) {
    test(`${panel}: its rows are a list with one tab stop`, async ({
      page,
    }) => {
      await openApp(page);
      await page.getByRole("button", { name: new RegExp(`^${panel}`) }).click();
      const aside = page.locator("aside");
      await expect(aside.locator("[data-row-open]").first()).toBeVisible({
        timeout: 15_000,
      });
      const { lists, stops } = await aside.evaluate((root) => {
        const lists = [...root.querySelectorAll("[data-list]")].filter((list) =>
          list.querySelector("[data-row-open]"),
        );
        const stops = [
          ...root.querySelectorAll<HTMLButtonElement>(
            '[data-row-open], [data-row] [role="checkbox"], [data-row] [aria-haspopup="menu"]',
          ),
        ].filter((el) => el.tabIndex >= 0 && !el.disabled);
        return { lists: lists.length, stops: stops.length };
      });
      expect(lists).toBeGreaterThan(0);
      expect(stops).toBe(lists);
      await expect(aside.getByRole("list").first()).toBeVisible();
    });
  }

  // Mutation: drop `usePanelFocus` and focus is the page's body after Enter,
  // and Escape does nothing.
  test("a place: Enter lands on the back arrow, Escape returns to its row", async ({
    page,
  }) => {
    const aside = await openPlaces(page);
    const row = aside.locator("[data-place-id]").nth(2);
    const open = row.locator("[data-row-open]");
    const name = (await open.textContent()) ?? "";
    await open.focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("button", { name: "Back to Places" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      aside.getByRole("button", { name, exact: true }),
    ).toBeFocused();
  });

  test("Settings: Escape leaves a sub-page for the row that opened it", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const aside = page.locator("aside");
    const row = aside.locator("[data-row-open]").first();
    const name = (await row.textContent()) ?? "";
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(aside.getByRole("button", { name: /^Back/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      aside.getByRole("button", { name, exact: true }),
    ).toBeFocused();
  });

  test("Skip to panel moves focus into the open panel", async ({ page }) => {
    await openPlaces(page);
    await page.getByRole("link", { name: "Skip to panel" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("aside")).toBeFocused();
  });

  // Mutation: drop the document listener in App.tsx and Measure stays armed.
  test("Escape lifts an armed Measure tool, and the Draw tool asks first", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const aside = page.locator("aside");
    const tools = page.getByRole("button", { name: "Tools", exact: true });
    const tray = page.getByRole("group", { name: "Tools" });

    await tools.click();
    await tray.getByRole("button", { name: "Measure distance" }).click();
    const heading = aside.getByRole("heading", {
      level: 2,
      name: "Measure distance",
    });
    await expect(heading).toBeVisible();
    await page.locator("canvas.maplibregl-canvas").focus();
    await page.keyboard.press("Escape");
    await expect(heading).toHaveCount(0);

    await tools.click();
    await tray.getByRole("button", { name: "Draw a route" }).click();
    const draw = aside.getByRole("heading", { level: 2, name: "New route" });
    await expect(draw).toBeVisible();
    await page.locator("canvas.maplibregl-canvas").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(draw).toBeVisible();
  });
});

/**
 * Ghost Gum, the one light scheme, on the surfaces most used outdoors. It is
 * reached the way a user's choice is: `/users/me` says so (rewriting only the
 * field the decision reads), and the generated `[data-scheme]` block repaints.
 * Its text pairs are held to 7:1 by `scripts/wcag-contrast.mjs`; this is what
 * catches a surface drawing a pair that script never heard of.
 */
test.describe("ghost gum", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/users/me", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const user = await response.json();
      await route.fulfill({
        response,
        json: {
          ...user,
          uiPreferences: { ...user.uiPreferences, themeSchemeId: "ghostGum" },
        },
      });
    });
  });

  test("Places, a place, Settings and the Inbox", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("html")).toHaveAttribute(
      "data-scheme",
      "ghostGum",
    );
    const aside = page.locator("aside");

    await page.getByRole("button", { name: "Places", exact: true }).click();
    await expect(aside.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");

    await aside
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();
    await expect(
      aside.getByRole("heading", { level: 2, name: "Claustral Canyon" }),
    ).toBeVisible();
    await expectNoViolations(page, "aside");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const theme = aside.getByRole("radiogroup", { name: "Theme" });
    await expect(theme.getByRole("radio")).toHaveCount(4);
    await expect(theme.getByRole("radio", { name: "Ghost Gum" })).toBeChecked();
    await expectNoViolations(page, "aside");

    await page.getByRole("button", { name: /^Inbox/ }).click();
    await expect(aside.getByRole("checkbox").first()).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page, "aside");
  });
});

test.describe("narrow web", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Plans at phone width: the list and a plan's page", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: /^Plans/ }).click();
    await expect(page.getByRole("radio", { name: /^Upcoming/ })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByRole("button", { name: "Wollangambe weekend", exact: true })
      .click();
    await expect(page.getByRole("radio", { name: /^Write-up/ })).toBeVisible();
    await expectNoViolations(page);

    // A form's page: its answers table scrolls sideways on its own.
    await page.getByRole("radio", { name: /^Forms/ }).click();
    await page
      .getByRole("button", { name: "Safety contacts", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Answers" }).getByRole("table"),
    ).toBeVisible();
    await expectNoViolations(page);

    // Invite people: the search, the role and the link, nothing sent.
    await page.getByRole("button", { name: "Back to the plan" }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Invite people" }).click();
    await expect(
      page.getByRole("button", { name: "Back to people" }),
    ).toBeFocused();
    await expectNoViolations(page);

    // A plan carol invited alice to: its preview, with Join and Decline.
    await page.getByRole("button", { name: "Back to people" }).click();
    await page.getByRole("button", { name: "Back to plans" }).click();
    await page
      .getByRole("button", { name: "Kanangra Walls loop", exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("a maintainer announcement inside the phone", async ({ page }) => {
    await withAnnouncementRead(page);
    await openApp(page);
    const dialog = await openAnnouncement(page, true);
    await expectNoViolations(page, "dialog");
    expect((await dialog.boundingBox())!.width).toBe(390);
  });

  test("the tab bar and its More menu", async ({ page }) => {
    await openApp(page);
    await expectNoViolations(page, "nav[aria-label='Pages']");
    await page.getByRole("button", { name: /^More/ }).click();
    await expect(page.getByRole("menu", { name: "More pages" })).toBeVisible();
    await expectNoViolations(page, "[role='menu']");
  });

  test("What is here?: the panel stays inside the phone", async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    const canvas = page.locator("canvas.maplibregl-canvas");
    await canvas.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "This point" });
    await expect(panel).toBeVisible();
    const inside = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth;
    });
    expect(inside).toBe(true);
    await expectNoViolations(page, "[role='dialog'][aria-label='This point']");
  });

  test("a recording's page: both charts stay inside the phone", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Ways", exact: true }).click();
    const sheet = page.locator("aside");
    await sheet
      .locator("[data-way-kind='track']")
      .first()
      .getByRole("button", { name: /^Actions for/ })
      .click({ timeout: 15_000 });
    await page.getByRole("menuitem", { name: "Open", exact: true }).click();
    const speed = sheet.getByRole("img", { name: /^Speed profile: / });
    await expect(speed).toBeVisible({ timeout: 15_000 });
    for (const chart of [
      sheet.getByRole("img", { name: /^Elevation profile: / }),
      speed,
    ]) {
      const box = (await chart.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await expectNoViolations(page, "aside");
  });

  // A drawing tool's work is on the map, so its sheet opens at the peek: the
  // note, the distance and Undo, with the map left to press. Dragging it up (the
  // keyboard does the same through the grab bar) brings back the rest.
  for (const tool of [
    {
      name: "Measure distance",
      title: "Measure distance",
      rest: "Clear all points",
    },
    { name: "Draw a route", title: "Draw a route", rest: "Save" },
  ]) {
    test(`${tool.name}: the tool's page opens at the peek, over little of the map`, async ({
      page,
    }) => {
      await openApp(page);
      await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("button", { name: tool.name }).click();
      const sheet = page.getByRole("complementary", { name: tool.title });
      await expect(sheet).toBeVisible();

      const height = page.getByRole("slider", { name: "Panel height" });
      await expect(height).toHaveAttribute("aria-valuetext", "Peek");
      // Under a quarter of the screen: most of the map is there to press.
      const top = (await sheet.boundingBox())!.y;
      expect(top).toBeGreaterThan(844 * 0.7);
      await expect(
        sheet.getByText("Distance", { exact: true }),
      ).toBeInViewport();
      await expect(
        sheet.getByRole("button", { name: "Undo" }),
      ).toBeInViewport();
      await expect(
        sheet.getByRole("button", { name: tool.rest, exact: true }),
      ).toHaveCount(0);

      await page.locator("canvas.maplibregl-canvas").focus();
      await page.keyboard.press("Enter");
      await expect(sheet.getByRole("status")).toHaveText("1 point");
      await expectNoViolations(page, "aside");
      await expectNoViolations(page, "#map");

      await height.focus();
      await page.keyboard.press("ArrowUp");
      await expect(height).toHaveAttribute("aria-valuetext", "Half height");
      await expect(
        sheet.getByRole("button", { name: tool.rest, exact: true }),
      ).toBeVisible();
      // The sheet slides for 200ms and its footer rides over the tab bar on the
      // way: measured at rest, as a user sees it.
      let last = Number.NaN;
      await expect
        .poll(
          async () => {
            const top = (await sheet.boundingBox())!.y;
            const still = top === last;
            last = top;
            return still;
          },
          { intervals: [250] },
        )
        .toBe(true);
      await expectNoViolations(page, "aside");
    });
  }

  test("a form dialog filling the phone's screen", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const sheet = page.getByRole("complementary", { name: "Places" });
    await expect(sheet.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });

    // `size="large"` fills a narrow screen from the kit's own CSS — a different
    // rule from the centred desktop dialog.
    await sheet
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();
    // The sheet is named after the page it holds, so opening a place RENAMES the
    // landmark — hold it by role from here, not by the name it used to have.
    const page_ = page.locator("aside");
    await expect(
      page.getByRole("complementary", { name: "Claustral Canyon" }),
    ).toBeVisible();
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

  test("a place's Add a way dialog stays inside the phone", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const sheet = page.getByRole("complementary", { name: "Places" });
    await sheet
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();
    const place = page.locator("aside");
    await place
      .getByRole("button", { name: /^(Add a way|Replace this place's route)$/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Add a way" });
    await expect(dialog).toBeVisible();
    await expectNoViolations(page, "dialog");
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
  });

  test("the bottom sheet is a named landmark whose height the keyboard sets", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();

    // The same complementary landmark the desktop panel is, named by its page:
    // a reader jumping by landmark should not lose the panel on a phone.
    const sheet = page.getByRole("complementary", { name: "Places" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await expect(sheet.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });
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

    // And it has no peek: half is the lowest the keys go.
    await page.keyboard.press("Home");
    await expect(height).toHaveAttribute("aria-valuetext", "Half height");
    await expect.poll(topAt).toBe(half);
  });

  // Narrow web has no Map tab: a panel is a sheet over the map, and closing it
  // is how a user gets back. Mutation that turns it red: put the Map button back
  // in NavRail, or drop Plans from the narrow tabs in NAV.
  test("the tab bar is Places, Trips, Ways, Plans and More, with no Map", async ({
    page,
  }) => {
    await openApp(page);
    const tabs = page.getByRole("navigation", { name: "Pages" });
    await expect(tabs.getByRole("button")).toHaveText([
      "Places",
      "Trips",
      "Ways",
      "Plans",
      "More",
    ]);
    await expect(tabs.getByRole("button", { name: "Map" })).toHaveCount(0);
  });

  // Mutation that turns it red: stop the grab bar's release from closing.
  test("swiping a panel down closes it and leaves the map to use", async ({
    page,
  }) => {
    await openApp(page);
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const sheet = page.getByRole("complementary", { name: "Places" });
    await expect(sheet).toBeVisible();

    const grip = (await page
      .getByRole("slider", { name: "Panel height" })
      .boundingBox())!;
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 150, { steps: 6 });
    await page.mouse.move(x, 844, { steps: 6 });
    await page.mouse.up();

    await expect(sheet).toHaveCount(0);
    // The map answers: its zoom control works and nothing covers the canvas.
    await page.getByRole("button", { name: "Zoom in" }).click();
    const canvas = (await page
      .locator("canvas.maplibregl-canvas")
      .boundingBox())!;
    const covered = await page.evaluate(
      ({ cx, cy }) =>
        !document.elementFromPoint(cx, cy)?.closest(".maplibregl-map"),
      { cx: canvas.x + canvas.width / 2, cy: canvas.y + canvas.height / 2 },
    );
    expect(covered).toBe(false);
  });

  // The pull is a touch on the list, not the grab bar. Mutation that turns it
  // red: remove the content's touch listeners from BottomSheet.tsx.
  test("pulling down on a list scrolled to its top closes the panel", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const sheet = page.getByRole("complementary", { name: "Places" });
    const row = sheet.locator("[data-place-id]").first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    const at = (await row.boundingBox())!;
    const x = at.x + at.width / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, y?: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: y === undefined ? [] : [{ x, y }],
      });
    await touch("touchStart", at.y);
    for (let y = at.y; y < 840; y += 40) await touch("touchMove", y);
    await touch("touchEnd");

    await expect(sheet).toHaveCount(0);
  });

  // A finger-sized hit area on the grab bar, whatever the pointer, grown upward
  // so it never covers the page. Mutation that turns it red: shrink `::after`
  // back to `--control-lg` (36px for a mouse), or grow it down into the hero.
  test("the grab bar is 44px to hit, and never covers the page's first button", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Places", exact: true }).click();
    const grip = (await page
      .getByRole("slider", { name: "Panel height" })
      .boundingBox())!;
    const bottom = grip.y + grip.height;
    const hits = await page.evaluate(
      ({ x, bottom }) =>
        [1, 43].map(
          (up) =>
            document.elementFromPoint(x, bottom - up)?.getAttribute("role") ===
            "slider",
        ),
      { x: grip.x + grip.width / 2, bottom },
    );
    expect(hits).toEqual([true, true]);

    // The top edge of the hero's ✕ is the page's, not the bar's.
    const close = page
      .locator("aside")
      .getByRole("button", { name: "Close", exact: true });
    await close.click({ position: { x: 10, y: 1 } });
    await expect(page.locator("aside")).toHaveCount(0);
  });

  // Every narrow page has a ✕ that closes it. Mutation that turns it red: draw a
  // `Hero` with `onClose={null}` on any of them.
  test("every panel closes by its Close button", async ({ page }) => {
    await openApp(page);
    const aside = page.locator("aside");
    const pages: [string, boolean][] = [
      ["Places", false],
      ["Trips", false],
      ["Ways", false],
      ["Plans", false],
      ["Inbox", true],
      ["Friends", true],
      ["Settings", true],
      ["Account", true],
    ];
    for (const [name, inMore] of pages) {
      if (inMore) {
        await page.getByRole("button", { name: /^More/ }).click();
        await page
          .getByRole("menuitem", { name: new RegExp(`^${name}`) })
          .click();
      } else {
        await page
          .getByRole("button", { name: new RegExp(`^${name}`) })
          .click();
      }
      const close = aside.getByRole("button", { name: "Close", exact: true });
      await expect(close, name).toBeVisible({ timeout: 15_000 });
      await close.click();
      await expect(aside, name).toHaveCount(0);
    }

    // A page opened from a row.
    await page.getByRole("button", { name: "Places", exact: true }).click();
    await aside
      .getByRole("button", { name: "Claustral Canyon", exact: true })
      .click();
    const close = aside.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeVisible();
    await close.click();
    await expect(aside).toHaveCount(0);
  });

  // The route tool's ✕ asks before it discards a line, so a swipe bottoms out at
  // its peek; Measure keeps nothing, so a swipe closes it. Mutation that turns
  // it red: pass `onClose` to the route tool's sheet, or withhold it from
  // Measure's.
  for (const tool of [
    { name: "Measure distance", title: "Measure distance", closes: true },
    { name: "Draw a route", title: "Draw a route", closes: false },
  ]) {
    test(`${tool.name}: a swipe down ${tool.closes ? "closes" : "stops at the peek"}`, async ({
      page,
    }) => {
      await openApp(page);
      await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("button", { name: tool.name }).click();
      const sheet = page.getByRole("complementary", { name: tool.title });
      await expect(sheet).toBeVisible();
      const grip = (await page
        .getByRole("slider", { name: "Panel height" })
        .boundingBox())!;
      const x = grip.x + grip.width / 2;
      const y = grip.y + grip.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, 700, { steps: 6 });
      await page.mouse.move(x, 843, { steps: 6 });
      await page.mouse.up();
      if (tool.closes) {
        await expect(sheet).toHaveCount(0);
      } else {
        await expect(sheet).toBeVisible();
        await expect(
          page.getByRole("slider", { name: "Panel height" }),
        ).toHaveAttribute("aria-valuetext", "Peek");
      }
    });
  }

  test("the sign-in card", async ({ page }) => {
    // The other width for a screen that is ONLY ever seen before any app shell
    // exists — no rail, no sheet, no map behind it, and the card is the whole
    // page rather than a thing centred in one.
    await page.goto(SIGN_IN_URL);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(page);
  });
});

// Three surfaces fake auth boots STRAIGHT PAST, and each for its own reason:
// `useAuth` sets "authenticated" on mount (so SignIn never renders), the seeded
// account's recorded consent is current (so the gate never shows), and it holds
// 311 places (so the first-login offer never fires). None of them is a viewport
// variant of something above — they are screens the dev stack cannot reach by
// navigation.
//
// Each is reachable here anyway: the gate and the offer are ordinary responses
// away, and SignIn is one env var away on the second local server. The two
// code screens need a mailbox, and a real sign-in needs a real pool, which is
// `auth-lifecycle.spec.ts`'s ground.
test.describe("surfaces fake auth never shows", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the sign-in page, its sign-up form and the reset form", async ({
    page,
  }) => {
    // The same bundle with `VITE_AUTH_MODE` not fake: no stored session, so
    // the session check resolves empty and useAuth lands on "signIn".
    await page.goto(SIGN_IN_URL);
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    // The terrain behind the card is drawn from the NSW DEM, whose licence
    // wants its credit shown with it, naming the area once that has loaded
    // (ADR 0031): in the corner when wide, in the card's footer (hidden here)
    // when narrow. Mutation that turns it red: drop the corner credit.
    await expect(
      page
        .getByText(
          /(Blue Mountains|Kanangra-Boyd)\. Elevation: derived from the NSW 5 m/,
        )
        .filter({ visible: true }),
    ).toBeVisible();
    await expectNoViolations(page);

    // Sign-up is where the two ticks live. The Terms and Privacy links are in
    // the first one's sentence, which is not a <label>, so reading the terms
    // doesn't answer the question about them (TermsTick.tsx).
    await page
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expectNoViolations(page);
    // The way in is never disabled: pressing it says what is missing
    // (shared/DESIGN.md §5).
    const create = page.getByRole("button", {
      name: "Create account",
      exact: true,
    });
    await expect(create).toBeEnabled();
    await page.getByRole("checkbox", { name: /agree to the Terms/ }).check();
    await page.getByRole("checkbox", { name: /18 or older/ }).check();
    await expect(create).toBeEnabled();

    // And back out to the reset form, which is the third reachable state.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(
      page.getByRole("button", { name: "Send reset code" }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("a plan link opened signed out: sign-up first, saying why", async ({
    page,
  }) => {
    // The token is held, never sent, until someone signs in, and someone
    // with a plan link has usually no account yet. Mutations: open on sign
    // in whatever is pending (useAuth's `firstScreen`), or drop the line.
    await page.goto(`${SIGN_IN_URL}/#plan-invite=${"c".repeat(43)}`);
    await expect(page.getByLabel("Confirm password")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("status").filter({ hasText: "A trip invite is waiting" }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/plan-invite/);
    await expectNoViolations(page);
  });

  test("the consent gate, on a brand-new account", async ({ page }) => {
    // A provider's sign-up page cannot ask for a username, the terms or an
    // age, so the gate does, for an account with no consent recorded.
    await page.route("**/users/me", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const user = await response.json();
      await route.fulfill({
        response,
        json: { ...user, consentVersion: null },
      });
    });
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Welcome to Logjam" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /agree to the Terms of Use/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: /18 or older/ }),
    ).toBeVisible();
    await expectNoViolations(page);
  });

  test("the consent gate, on an account whose consent is stale", async ({
    page,
  }) => {
    // The gate renders INSTEAD of the app when the recorded version is stale
    // (App.tsx), so re-writing the one field the decision reads is the whole
    // cost of reaching it. GET only: this path is also PATCHed on the way out
    // of the gate, and that must stay a real request.
    await page.route("**/users/me", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const user = await response.json();
      await route.fulfill({
        response,
        json: { ...user, consentVersion: "2000-01-01" },
      });
    });
    await page.goto("/");

    const gate = page.getByRole("heading", { name: "Updated terms" });
    await expect(gate).toBeVisible({ timeout: 15_000 });
    // Nothing behind the gate: no map, no rail, no panel.
    await expect(page.locator("nav[aria-label='Pages']")).toHaveCount(0);
    await expectNoViolations(page);

    // The button is the only way on and is never disabled: pressed without the
    // tick it asks for the tick, and writes nothing. The case stops there:
    // agreeing writes consent to the account.
    const agree = page.getByRole("button", { name: "Agree and continue" });
    await expect(agree).toBeEnabled();
    await agree.click();
    await expect(page.getByRole("alert")).toContainText("Tick the box");
    await expectNoViolations(page);
    await page
      .getByRole("checkbox", { name: /agree to the updated Terms/ })
      .check();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(agree).toBeEnabled();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  test("the first-login offer, on an account that loaded empty", async ({
    page,
  }) => {
    // It opens only on a load that SUCCEEDED and came back empty (App.tsx), so
    // the stub is a real 200 with a real total — a failed fetch must not open
    // it. Nothing is written: the case presses neither row.
    await page.route("**/places", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/json", "X-Total-Count": "0" },
        body: "[]",
      });
    });
    await page.goto("/");

    const offer = page.getByRole("dialog", { name: "Welcome to Logjam" });
    await expect(offer).toBeVisible({ timeout: 15_000 });
    await expect(
      offer.getByText("Load the NSW place database (RopeWiki)"),
    ).toBeVisible();
    await expectNoViolations(page, "dialog");

    // Closing it is starting empty — the hub is not a question that has to be
    // answered (OnboardingChoiceDialog.tsx).
    await page.keyboard.press("Escape");
    await expect(offer).toHaveCount(0);
    await expect(page.locator("nav[aria-label='Pages']")).toBeVisible();
  });
});
