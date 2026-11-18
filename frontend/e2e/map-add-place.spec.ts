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
