import { test, expect, type Locator, type Page } from "@playwright/test";
import { SEED_NAMES } from "../../api/prisma/seedNames";

// Adding a place from the map's tools asks where first: the map is armed to
// pick a spot, and the form opens already holding it. Nothing is saved.

test.use({ viewport: { width: 1440, height: 900 } });

async function startFromTools(page: Page) {
  await page.goto("/");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("group", { name: "Tools" })
    .getByRole("button", { name: "Add a place" })
    .click();
  return canvas;
}

// Mutation: put `setShowAdd(true)` back as the tool's action, and the form
// opens before the spot is chosen.
test("the Add a place tool picks a spot on the map, then opens the form on it", async ({
  page,
}) => {
  const canvas = await startFromTools(page);
  await expect(page.getByText("the map to select a location")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add a place" })).toHaveCount(
    0,
  );

  await canvas.click({ position: { x: 700, y: 400 } });
  const form = page.getByRole("dialog", { name: "Add a place" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel(/^Latitude/)).not.toHaveValue("");
  await expect(form.getByLabel(/^Longitude/)).not.toHaveValue("");
});

// Mutation: have the picker's Cancel fall through to opening the form.
test("cancelling the pick opens nothing", async ({ page }) => {
  await startFromTools(page);
  await expect(page.getByText("the map to select a location")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("the map to select a location")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Add a place" })).toHaveCount(
    0,
  );
});

// Mutation: drop `toolsLocked` from the Tools button (Map.tsx, MapChrome.tsx),
// and a tool chosen over a form's pick replaces the form's callback and loses
// its pick.
test("Tools is off while a form's own Select on map is armed", async ({
  page,
}) => {
  const canvas = await openMap(page);
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page
    .locator("aside")
    .getByRole("button", { name: /^Add/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Add a place" }).click();
  const form = page.getByRole("dialog", { name: "Add a place" });
  await form.getByRole("button", { name: "Select on map" }).click();
  await expect(pickPill(page)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tools", exact: true }),
  ).toBeDisabled();
  await canvas.click({ position: { x: 800, y: 500 } });
  await expect(page.getByRole("dialog", { name: "Add a place" })).toHaveCount(
    1,
  );
  await expect(form.getByLabel(/^Latitude/)).not.toHaveValue("");
});

const tools = (page: Page) =>
  page.getByRole("button", { name: "Tools", exact: true });
const tray = (page: Page) => page.getByRole("group", { name: "Tools" });
const pickPill = (page: Page) => page.getByText("the map to select a location");

/** The pick's pill and Cancel sit on the middle of the map, not of what a page
 *  beside it leaves. */
async function expectPickCentred(page: Page) {
  const centreX = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return box.x + box.width / 2;
  };
  const map = await centreX(page.locator("#map"));
  expect(Math.abs((await centreX(pickPill(page))) - map)).toBeLessThan(2);
  expect(
    Math.abs(
      (await centreX(
        page.getByRole("button", { name: "Cancel", exact: true }),
      )) - map,
    ),
  ).toBeLessThan(2);
}

async function openMap(page: Page) {
  await page.goto("/");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  return canvas;
}

// Mutation: drop the `drawingRoute` branch from the tool in App.tsx, and the
// pick starts over a route still being drawn.
test("the tool ends an armed Measure, and asks before it drops a route with points", async ({
  page,
}) => {
  const canvas = await openMap(page);
  const aside = page.locator("aside");
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Measure distance" }).click();
  const measure = aside.getByRole("heading", {
    level: 2,
    name: "Measure distance",
  });
  await expect(measure).toBeVisible();
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Add a place" }).click();
  await expect(pickPill(page)).toBeVisible();
  await expect(measure).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(pickPill(page)).toHaveCount(0);

  await tools(page).click();
  await tray(page).getByRole("button", { name: "Draw a route" }).click();
  const draw = aside.getByRole("heading", { level: 2, name: "New route" });
  await expect(draw).toBeVisible();
  await canvas.click({ position: { x: 600, y: 300 } });
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Add a place" }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Discard this route?",
  });
  await expect(confirm).toBeVisible();
  await expect(pickPill(page)).toHaveCount(0);
  // Keeping the route keeps the tool, and starts no pick.
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(draw).toBeVisible();
  await expect(pickPill(page)).toHaveCount(0);

  await tools(page).click();
  await tray(page).getByRole("button", { name: "Add a place" }).click();
  await confirm.getByRole("button", { name: "Discard" }).click();
  await expect(pickPill(page)).toBeVisible();
  await expect(draw).toHaveCount(0);
});

// Mutation: drop `setActivePanel(null)` from the tool: the page stays beside the
// pick (it is still in the document), and a plan's bar crowds the pill.
for (const [device, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
] as const) {
  for (const open of ["Places", "a plan"] as const) {
    test(`the pick centres its pill and Cancel on the map, ${device}, ${open} open`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await openMap(page);
      if (open === "Places") {
        await page.getByRole("button", { name: "Places", exact: true }).click();
      } else {
        await page.getByRole("button", { name: /^Plans/ }).click();
        await page
          .getByRole("button", {
            name: SEED_NAMES.planWollangambe,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", { name: "Back to my map" }),
        ).toBeVisible({ timeout: 15_000 });
      }
      // On a phone the page's sheet covers the tools, so a pointer cannot reach
      // them: the press is the button's own.
      const press = (locator: Locator) =>
        device === "phone"
          ? locator.evaluate((el) => (el as HTMLElement).click())
          : locator.click();
      await press(tools(page));
      await press(tray(page).getByRole("button", { name: "Add a place" }));
      await expect(pickPill(page)).toBeVisible();
      // Back on the user's own map: no page and no plan bar beside the pill.
      await expect(page.locator("aside")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Back to my map" }),
      ).toHaveCount(0);
      await expectPickCentred(page);
    });
  }
}

// The same pick, started from a form on an open place page: the page steps
// aside for the pick and the map is measured from its own edge.
// Mutation: put `activePanel !== null` back as the Map's `panelOpen` (App.tsx).
test("a form's own pick centres its pill and Cancel too, with the place page open", async ({
  page,
}) => {
  await openMap(page);
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page
    .locator("aside")
    .locator("[data-place-id]")
    .filter({ hasText: SEED_NAMES.hiddenSlot })
    .first()
    .click();
  await page
    .locator("aside")
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit place" }).click();
  await page
    .getByRole("dialog", { name: "Edit place" })
    .getByRole("button", { name: "Select on map" })
    .click();
  await expect(pickPill(page)).toBeVisible();
  await expectPickCentred(page);
});

// A box pick (Make a map → GeoTIFF → Pick on the map) over an armed Draw tool:
// the dialog steps aside and the route being drawn is still armed under it.
async function boxPickOverDraw(page: Page) {
  const canvas = await openMap(page);
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Draw a route" }).click();
  await canvas.click({ position: { x: 600, y: 300 } });
  await canvas.click({ position: { x: 700, y: 400 } });
  const handles = page.locator('[title^="Drag to move"]');
  await expect(handles).toHaveCount(2);
  await tools(page).click();
  await tray(page).getByText("Make a map").click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("radio", { name: "GeoTIFF" }).click();
  await dialog.getByRole("button", { name: "Pick on the map" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  return { canvas, handles };
}

// Mutation: drop the `pickModeRef` guard from the draw click or the line's
// `onDown`, or leave the handles mounted under a pick (`pickMode` in their
// effect): a click sets the box's corner and also adds a point, a drag on the
// line inserts one, a press on a handle removes its point.
test("under a box pick the drawn line and its handles are inert, and come back after", async ({
  page,
}) => {
  const { canvas, handles } = await boxPickOverDraw(page);
  await expect(handles).toHaveCount(0);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 650, box.y + 350);
  await page.mouse.down();
  await page.mouse.move(box.x + 680, box.y + 320, { steps: 8 });
  await page.mouse.up();
  await canvas.click({ position: { x: 900, y: 600 } });

  // The pick is over (a corner is set): Cancel hands the map back, and the
  // route is as it was, two points.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(handles).toHaveCount(2);
});

// Mutation: leave the pick's `panelOpen` off for every pick (`!mapInteractionActive`
// instead of `!dimUI` in App.tsx): the topo pick keeps its page on screen, and
// the search box slides under it.
test("a topo pick leaves the open page where it is, and the map's chrome beside it", async ({
  page,
}) => {
  await openMap(page);
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const search = page.getByLabel("Search places and locations");
  const before = (await search.boundingBox())!.x;
  await tools(page).click();
  await tray(page).getByText("Sharpen an area").click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: /Haven.t got one/ }).click();
  await dialog.getByRole("button", { name: "Draw the area" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.getByText("Click to set a corner")).toBeVisible();
  await expect(page.locator("aside")).toBeVisible();
  expect(Math.abs((await search.boundingBox())!.x - before)).toBeLessThan(2);
});

// Mutation: put `style.cursor = ""` back in the pick's effect (Map.tsx), and a
// pick that ends over an armed Draw tool leaves it without its crosshair. The
// search box is how a place page opens while a route is being drawn.
test("the armed Draw tool keeps its crosshair when a form's pick is cancelled", async ({
  page,
}) => {
  const canvas = await openMap(page);
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Draw a route" }).click();
  await expect(canvas).toHaveCSS("cursor", "crosshair");
  await page.getByLabel("Search places and locations").fill("Hidden Slot");
  await page
    .getByRole("option", { name: new RegExp(SEED_NAMES.hiddenSlot) })
    .first()
    .click();
  await page
    .locator("aside")
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit place" }).click();
  await page
    .getByRole("dialog", { name: "Edit place" })
    .getByRole("button", { name: "Select on map" })
    .click();
  await expect(pickPill(page)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(canvas).toHaveCSS("cursor", "crosshair");
});

// Mutation: drop `endToolPick()` from a tool's action (App.tsx), and a tool
// chosen over the Add a place pick starts with the pick still armed.
test("a tool chosen over the Add a place pick ends the pick and starts", async ({
  page,
}) => {
  await openMap(page);
  const aside = page.locator("aside");
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Add a place" }).click();
  await expect(pickPill(page)).toBeVisible();
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Measure distance" }).click();
  await expect(pickPill(page)).toHaveCount(0);
  await expect(
    aside.getByRole("heading", { level: 2, name: "Measure distance" }),
  ).toBeVisible();

  await tools(page).click();
  await tray(page).getByRole("button", { name: "Add a place" }).click();
  await expect(pickPill(page)).toBeVisible();
  await tools(page).click();
  await tray(page).getByRole("button", { name: "Draw a route" }).click();
  await expect(pickPill(page)).toHaveCount(0);
  await expect(
    aside.getByRole("heading", { level: 2, name: "New route" }),
  ).toBeVisible();
});
