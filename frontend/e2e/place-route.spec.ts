import { test, expect, type Page } from "@playwright/test";

// A place's route is added from its own page, the way photos are, with no edit
// dialog: from a way already in the account, or from a GPX/KML file. The seed
// gives alice a place with no way (Hidden Slot), a drawn route
// that is on no place (Du Faur Head approach) and imports and recordings that
// are on none. Each case puts the account back as it found it.

// Both cases use the one place, so they cannot overlap.
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1440, height: 900 } });

async function openHiddenSlot(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const aside = page.locator("aside");
  await aside
    .locator("[data-place-id]")
    .filter({ hasText: "Hidden Slot" })
    .first()
    .click();
  await expect(aside.getByText("No route yet.")).toBeVisible({
    timeout: 15_000,
  });
  return aside;
}

// Mutation: drop the owner-only "Add a way" button from the Route section, or
// stop `updateRoute` writing the placeId.
test("an owner adds a route from a way already in the app", async ({
  page,
}) => {
  const aside = await openHiddenSlot(page);
  await aside.getByRole("button", { name: "Add a way" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a way" });
  await dialog
    .getByRole("button", { name: /^Choose a route you drew/ })
    .click();
  // A sub-view is the same dialog, retitled for the step.
  await page
    .getByRole("dialog", { name: "Choose a route you drew" })
    .getByRole("button", { name: /^Du Faur Head approach/ })
    .click();

  try {
    await expect(page.getByText("Route linked to this place.")).toBeVisible();
    await expect(aside.getByText("Du Faur Head approach")).toBeVisible();
    await expect(
      aside.getByRole("button", { name: "Replace this place's route" }),
    ).toBeVisible();
  } finally {
    // Put it back, even when an assertion failed: the cases share one place.
    const unlink = aside.getByRole("button", {
      name: "Unlink from this place",
    });
    if ((await unlink.count()) > 0) {
      await unlink.click();
      await expect(page.getByText("Route unlinked.")).toBeVisible();
    }
  }
});

// Mutation: send the picked file to the edit dialog's uploader only, or skip
// the extension check.
test("an owner adds a route from a GPX file", async ({ page }) => {
  const aside = await openHiddenSlot(page);
  await aside.getByRole("button", { name: "Add a way" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a way" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "e2e-line.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(
      '<?xml version="1.0"?><gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="-33.60" lon="150.30"/><trkpt lat="-33.61" lon="150.31"/></trkseg></trk></gpx>',
    ),
  });

  try {
    await expect(
      page.getByText("Route file linked to this place."),
    ).toBeVisible();
    await expect(aside.getByText("e2e-line.gpx")).toBeVisible();
  } finally {
    // Put it back, even when an assertion failed.
    const remove = aside.getByRole("button", {
      name: "Delete the track e2e-line.gpx",
    });
    if ((await remove.count()) > 0) {
      await remove.click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Delete", exact: true })
        .click();
      await expect(aside.getByText("No route yet.")).toBeVisible();
    }
  }
});
