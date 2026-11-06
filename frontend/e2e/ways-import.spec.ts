import { test, expect } from "@playwright/test";

// A GPX file imported from the Ways list, end to end: Add → the picker → the
// stored import appears as a row, and the CSV importer is no longer offered
// there. The parse and the upload are pinned by unit tests; this is the glue
// between the picker, the API's presign/confirm and the list.
//
// Writes to the account, then takes it back: the case ends by deleting the
// import (also when an assertion fails). Deleting leaves a sync tombstone, so
// a local integration run after this spec needs a re-seed (`_globalSetup.ts`).
//
// Mutation that turns it red: pointing RoutesPanel's import back at the CSV
// importer (the picker never opens), or dropping `origin` from the upload
// (the API refuses a standalone file without one).
//
// Local only: it needs fake auth and a seeded API (frontend/AGENTS.md).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);

test("Ways imports a GPX file as an Import row, and offers no CSV", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Ways", exact: true }).click();

  await page.getByRole("button", { name: /^Add/ }).first().click();
  await expect(page.getByRole("menuitem", { name: /CSV/ })).toHaveCount(0);
  // The menu entry opens the picker, whose file goes through the same input.
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("menuitem", { name: "Import GPX, KML or GeoJSON" })
    .click();
  await (await chooser).setFiles(
    new URL("./__fixtures__/made-up-ridge.gpx", import.meta.url).pathname,
  );

  const row = page.locator('[data-way-kind="import"]', {
    hasText: "Made-up ridge",
  });
  try {
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText("“Made-up ridge” is saved under Imports."),
    ).toBeVisible();
  } finally {
    // Take it back out of the account, whatever happened above.
    if (await row.count()) {
      await row.getByRole("button", { name: /^Actions for / }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: /^Delete/ })
        .click();
      await expect(row).toHaveCount(0);
    }
  }
});
