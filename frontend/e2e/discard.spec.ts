import { test, expect, type Page } from "@playwright/test";

// A form with typing in it asks before any way out loses it: Escape, the close
// button, Cancel and a press on the backdrop (`Dialog`'s `discard`). Red when
// one of them closes the dialog without asking.

test.use({ viewport: { width: 1440, height: 900 } });

async function openAddPlace(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page.getByRole("button", { name: /^Add/ }).first().click();
  await page.getByRole("menuitem", { name: "Add a place" }).click();
  const form = page.getByRole("dialog", { name: "Add a place" });
  await expect(form).toBeVisible();
  return form;
}

test("an untouched form closes without asking", async ({ page }) => {
  const form = await openAddPlace(page);
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(form).toBeHidden();
  await expect(page.getByRole("alertdialog")).toBeHidden();
});

for (const [way, exit] of [
  ["Escape", (page: Page) => page.keyboard.press("Escape")],
  [
    "the close button",
    (page: Page) =>
      page
        .getByRole("dialog", { name: "Add a place" })
        .getByRole("button", { name: "Close" })
        .click(),
  ],
  [
    "Cancel",
    (page: Page) =>
      page
        .getByRole("dialog", { name: "Add a place" })
        .getByRole("button", { name: "Cancel" })
        .click(),
  ],
  ["the backdrop", (page: Page) => page.mouse.click(5, 450)],
] as const) {
  test(`${way} on a typed form asks, and Cancel keeps it`, async ({ page }) => {
    const form = await openAddPlace(page);
    await form.getByLabel(/^Name/).first().fill("Unsaved name");
    await exit(page);

    const confirm = page.getByRole("alertdialog", {
      name: "Discard this place?",
    });
    await expect(confirm).toBeVisible();
    await expect(form).toBeVisible();

    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(form.getByLabel(/^Name/).first()).toHaveValue("Unsaved name");

    await exit(page);
    await page
      .getByRole("alertdialog", { name: "Discard this place?" })
      .getByRole("button", { name: "Discard" })
      .click();
    await expect(form).toBeHidden();
  });
}

test("editing a trip asks about the changes, and Cancel is Cancel", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Trips", exact: true }).click();
  const aside = page.locator("aside");
  await aside
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Edit trip" }).click();
  const form = page.getByRole("dialog", { name: "Edit trip" });
  await form.getByLabel("Title").fill("Changed title");
  await form.getByRole("button", { name: "Cancel" }).click();

  const confirm = page.getByRole("alertdialog", {
    name: "Discard your changes?",
  });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("The trip stays as it was.");
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(form.getByLabel("Title")).toHaveValue("Changed title");
});

// An upload is saved the moment it lands, so it counts as a change and Discard
// takes it back out. Red when Cancel closes without asking, or the file is
// still on the place after Discard.
test("a track attached in the edit form goes again on Discard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const aside = page.locator("aside");
  // The seed's one place with no route (place-route.spec.ts uses it too), by
  // name: the first row is not a place the spec can rely on to be empty.
  const openActions = () =>
    aside
      .locator("[data-place-id]")
      .filter({ hasText: "Hidden Slot" })
      .getByRole("button", { name: /^Actions for / })
      .click();
  await openActions();
  const editPlace = async () => {
    await page.getByRole("menuitem", { name: "Edit place" }).click();
    return page.getByRole("dialog", { name: "Edit place" });
  };

  let form = await editPlace();
  await expect(form.getByText("No route yet.")).toBeVisible();
  await form
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "attached.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(
        '<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><trkseg>' +
          '<trkpt lat="-33.7" lon="150.3"/><trkpt lat="-33.71" lon="150.31"/>' +
          "</trkseg></trk></gpx>",
      ),
    });
  await expect(form.getByText("No route yet.")).toBeHidden();

  await form.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("alertdialog", { name: "Discard your changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(form).toBeHidden();

  // Edit from a row opens the place's page underneath the form.
  await aside.getByRole("button", { name: "Back to Places" }).click();
  await openActions();
  form = await editPlace();
  await expect(form.getByText("No route yet.")).toBeVisible();
});
