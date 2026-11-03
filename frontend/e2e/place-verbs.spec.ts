import { test, expect, type Page } from "@playwright/test";

// A place offers the same verbs from its row as from its page
// (`PLACE_VERBS` in `@logjam/shared`). The row runs what it can; a verb that
// needs a form or a confirm opens the place's page and runs there. Red when
// the row's menu withholds a verb, or the hand-off stops arriving.

async function openPlaces(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Places", exact: true }).click();
  const aside = page.locator("aside");
  await expect(aside.locator("[data-place-id]").first()).toBeVisible({
    timeout: 15_000,
  });
  return aside;
}

test.use({ viewport: { width: 1440, height: 900 } });

// Mutation: point the chip back at `setActivePanel("settings")`.
test("New type opens the form over Places, not the Settings page", async ({
  page,
}) => {
  const aside = await openPlaces(page);
  await aside.getByRole("button", { name: "New type" }).click();
  await expect(
    page.getByRole("dialog", { name: "New place type" }),
  ).toBeVisible();
  await expect(aside.getByRole("heading", { name: "Places" })).toBeVisible();
});

test("an owned place's row has every verb, and Edit opens the form on its page", async ({
  page,
}) => {
  const aside = await openPlaces(page);
  await aside.getByRole("button", { name: /^Sort and filter/ }).click();
  await aside.getByRole("button", { name: /^Visited/ }).click();
  await aside.getByRole("button", { name: "Done" }).click();
  await aside
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open place",
    "Log a trip here",
    "Edit place",
    "Sharpen the area here",
    "Export the area here",
    "Share or export…",
    "Delete place",
  ]);

  await menu.getByRole("menuitem", { name: "Edit place" }).click();
  await expect(page.getByRole("dialog", { name: "Edit place" })).toBeVisible();
  // The page it was handed to is underneath, not the list.
  await expect(
    aside.getByRole("button", { name: "Back to Places" }),
  ).toHaveCount(1);
});

test("a shared place's row offers to keep and to let go, never to edit or delete", async ({
  page,
}) => {
  const aside = await openPlaces(page);
  await aside.getByRole("button", { name: /^Sort and filter/ }).click();
  await aside.getByRole("button", { name: /^Shared/ }).click();
  await aside.getByRole("button", { name: "Done" }).click();
  await aside
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open place",
    "Sharpen the area here",
    "Export the area here",
    "Save a copy",
    "Save a copy and remove",
    "Remove from my account",
  ]);

  // The confirm lives on the place's page; the row hands the verb over.
  await menu.getByRole("menuitem", { name: "Remove from my account" }).click();
  await expect(
    page.getByRole("heading", { name: "Remove shared place?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

// Mutation: drop the owner-only PlacePicker or the Unlink menu entry from the
// "linkedPlaces" section, or the MediaUpload from "photos", in PlaceDetailPanel.
test("an owner links and unlinks places, and adds photos, on the place's page", async ({
  page,
}) => {
  const aside = await openPlaces(page);
  const other = (
    (await aside.locator("[data-place-id] >> nth=1").innerText()) || ""
  ).split("\n")[0];
  await aside.locator("[data-place-id]").first().click();

  await expect(aside.getByText("Drop files or click to upload")).toBeVisible();

  await aside.getByRole("combobox", { name: "Link a place" }).fill(other);
  await page.getByRole("option", { name: other, exact: true }).first().click();
  await expect(page.getByText(`Linked to ${other}.`)).toBeVisible();

  await aside.getByRole("button", { name: `Actions for ${other}` }).click();
  await page.getByRole("menuitem", { name: "Unlink from this place" }).click();
  await expect(page.getByText("Unlinked.")).toBeVisible();
});
