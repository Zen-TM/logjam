import { test, expect } from "@playwright/test";

// Adding a place from the map's tools asks where first: the map is armed to
// pick a spot, and the form opens already holding it. Nothing is saved.

test.use({ viewport: { width: 1440, height: 900 } });

async function startFromTools(page: import("@playwright/test").Page) {
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

// Mutation: drop `if (pickModeRef.current) return;` from the draw handler in
// Map.tsx, and the click that picks the place also adds a point.
test("the pick over an armed Measure tool adds no point to the measurement", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  const tray = page.getByRole("group", { name: "Tools" });
  await tools.click();
  await tray.getByRole("button", { name: "Measure distance" }).click();
  await canvas.click({ position: { x: 600, y: 300 } });
  const status = page.getByRole("status").filter({ hasText: /points?$/ });
  await expect(status).toHaveText("1 point");

  await tools.click();
  await tray.getByRole("button", { name: "Add a place" }).click();
  await canvas.click({ position: { x: 800, y: 500 } });
  const form = page.getByRole("dialog", { name: "Add a place" });
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
  await expect(status).toHaveText("1 point");
});

// Mutation: drop `if (pickingCoords) return;` from the tool in App.tsx, and
// the tool's callback replaces the form's, so its pick is lost.
test("the tool does nothing while a form's own Select on map is armed", async ({
  page,
}) => {
  await page.goto("/");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page
    .locator("aside")
    .getByRole("button", { name: /^Add/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Add a place" }).click();
  const form = page.getByRole("dialog", { name: "Add a place" });
  await form.getByRole("button", { name: "Select on map" }).click();
  await expect(page.getByText("the map to select a location")).toBeVisible();

  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page
    .getByRole("group", { name: "Tools" })
    .getByRole("button", { name: "Add a place" })
    .click();
  await canvas.click({ position: { x: 800, y: 500 } });
  await expect(page.getByRole("dialog", { name: "Add a place" })).toHaveCount(
    1,
  );
  await expect(form.getByLabel(/^Latitude/)).not.toHaveValue("");
});

// A pick over an armed Measure tool: two points drawn, then Tools → Add a place.
async function pickOverMeasure(page: import("@playwright/test").Page) {
  await page.goto("/");
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  const tools = page.getByRole("button", { name: "Tools", exact: true });
  const tray = page.getByRole("group", { name: "Tools" });
  await tools.click();
  await tray.getByRole("button", { name: "Measure distance" }).click();
  await canvas.click({ position: { x: 600, y: 300 } });
  await canvas.click({ position: { x: 700, y: 400 } });
  const status = page.getByRole("status").filter({ hasText: /points?$/ });
  await expect(status).toHaveText("2 points");
  const handles = page.locator('[title^="Drag to move"]');
  await expect(handles).toHaveCount(2);
  await tools.click();
  await tray.getByRole("button", { name: "Add a place" }).click();
  await expect(page.getByText("the map to select a location")).toBeVisible();
  return { canvas, status, handles };
}

// Mutation: leave the vertex handles mounted under a pick (Map.tsx's `pickMode`
// in their effect), or drop the pick guard from the line's `onDown`: a press on
// a handle removes its point, a drag on the line inserts one.
test("under a pick the drawn line and its handles are inert, and come back after", async ({
  page,
}) => {
  const { canvas, status, handles } = await pickOverMeasure(page);
  await expect(handles).toHaveCount(0);
  // The middle of the line between the two points, in page coordinates.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 650, box.y + 350);
  await page.mouse.down();
  await page.mouse.move(box.x + 680, box.y + 320, { steps: 8 });
  await page.mouse.up();
  await expect(status).toHaveText("2 points");

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(handles).toHaveCount(2);
  await expect(status).toHaveText("2 points");
});

// Mutation: put `style.cursor = ""` back in the pick effect, and the armed
// tool loses its crosshair when the pick ends.
test("the armed tool keeps its crosshair after a pick is cancelled", async ({
  page,
}) => {
  const { canvas } = await pickOverMeasure(page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(canvas).toHaveCSS("cursor", "crosshair");
});

// Mutation: drop `pickingCoords` from App.tsx's Escape handler, and the press
// ends the Measure tool under the pick and leaves the pick armed.
test("Escape ends the pick first, then the tool under it", async ({ page }) => {
  const { canvas } = await pickOverMeasure(page);
  const heading = page.locator("aside").getByRole("heading", {
    level: 2,
    name: "Measure distance",
  });
  await canvas.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByText("the map to select a location")).toHaveCount(0);
  await expect(heading).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(heading).toHaveCount(0);
});
