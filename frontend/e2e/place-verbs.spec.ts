import { test, expect, type Page } from "@playwright/test";

// A place offers the same verbs from its row as from its page
// (`PLACE_VERBS` in `@logjam/shared`). The row runs what it can; a verb that
// needs a form or a confirm opens the place's page and runs there. Red when
// the row's menu withholds a verb again, or the hand-off stops arriving.

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

test("an owned place's row has every verb, and Edit opens the form on its page", async ({
  page,
}) => {
  const aside = await openPlaces(page);
  await aside.getByRole("radio", { name: /^Visited/ }).click();
  await aside
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open place",
    "Log a trip here",
    "Edit place",
    "Make a LiDAR topo here",
    "Make a GeoPDF here",
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
  await aside.getByRole("radio", { name: /^Shared/ }).click();
  await aside
    .getByRole("button", { name: /^Actions for / })
    .first()
    .click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Open place",
    "Make a LiDAR topo here",
    "Make a GeoPDF here",
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
