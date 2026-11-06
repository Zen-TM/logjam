import { test, expect } from "@playwright/test";

// A destructive confirm names its thing and wears the warning fill with a
// glyph; Cancel keeps it. Red when the title goes generic or the verb loses
// its glyph (`ConfirmDialog`).

test.use({ viewport: { width: 1440, height: 900 } });

test("deleting a place asks by name, in the warning fill, and Cancel keeps it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const aside = page.getByRole("complementary");
  await aside
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Delete place" }).click();

  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("heading")).toHaveText(/^Delete .+\?$/);
  const verb = confirm.getByRole("button", { name: "Delete", exact: true });
  await expect(verb.locator("svg")).toHaveCount(1);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
});
