import { test, expect, type Locator, type Page } from "@playwright/test";

// The CSV import end to end: choose a file in the import dialog → column map →
// (match review) → confirm → result → Undo. The parsing and row preparation are
// pinned by the goldens in src/csvImport/__fixtures__/corpus and the bulk
// endpoints by api-integration; this is the glue between them, which neither
// reaches. The expected values below are those files' goldens.
//
// Writes to the account, then takes it back: every case ends in Undo (also when
// an assertion fails, `undoWhatWasImported`), and touches no seeded place,
// because Undo spares a place an import merged into. Undo leaves sync
// tombstones behind, so a local integration run after this spec needs a
// re-seed: `_globalSetup.ts` refuses to start on a DB that differs from the seed.
// Undo lives on the result, so what the import did is read there, before Undo.
//
// Mutations that turn it red: making `handleUndo` in UnifiedImportDialog skip
// `undoImport` (the created places stay in the list), or making `detectColumns`
// or `placeColumns.ts` assign another role (the mapping step shows it).
//
// Local only: it needs fake auth and a seeded API (frontend/AGENTS.md).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);

const corpus = (file: string) =>
  new URL(`../src/csvImport/__fixtures__/corpus/${file}`, import.meta.url)
    .pathname;

async function openImportDialog(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Places", exact: true }).click();
  await page.getByRole("button", { name: /^Add/ }).first().click();
  await page.getByRole("menuitem", { name: "Import from file" }).click();
  // Not the Undo confirm: that one is an alertdialog.
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Import data" }),
  ).toBeVisible();
  return dialog;
}

const next = (dialog: Locator) =>
  dialog.getByRole("button", { name: "Next", exact: true }).click();

/** The result's tallies, label over value, in the order shown. */
async function expectTallies(dialog: Locator, tallies: Record<string, string>) {
  await expect(dialog.getByRole("term")).toHaveText(Object.keys(tallies));
  await expect(dialog.getByRole("definition")).toHaveText(
    Object.values(tallies),
  );
}

/** Undo, if the result is on screen: the way out of a case that failed midway. */
async function undoWhatWasImported(page: Page, dialog: Locator) {
  // A failure while the request is in flight: let it land, or it is never undone.
  await dialog
    .getByRole("heading", { name: "Importing…" })
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {});
  const undo = dialog.getByRole("button", { name: "Undo this import" });
  if (!(await undo.isVisible())) return;
  await undo.click();
  await page
    .getByRole("alertdialog", { name: "Undo this import?" })
    .getByRole("button", { name: "Undo the import" })
    .click();
  await expect(dialog).toHaveCount(0);
}

test("a place list: map, preview, import, see it in Places, Undo", async ({
  page,
}) => {
  const dialog = await openImportDialog(page);
  try {
    await dialog
      .locator("input[type=file]")
      .setInputFiles(corpus("places/new-places-only.csv"));

    // The mapping step: each column landed on its role (the golden's
    // `assignments`).
    await expect(
      dialog.getByRole("heading", { name: /^Place columns/ }),
    ).toBeVisible({ timeout: 15_000 });
    const roles = {
      Name: "name",
      Latitude: "latitude",
      Longitude: "longitude",
      Notes: "notes",
    };
    for (const [header, role] of Object.entries(roles)) {
      await expect(
        dialog.getByRole("combobox", { name: `What "${header}" is` }),
      ).toHaveValue(role);
    }

    // Both rows are new, so there is no review step. The file avoids the
    // seeded places on purpose: Undo spares a place an import merged into, with
    // the file's values still written (api/src/routes/imports.ts).
    await next(dialog);
    await expect(
      dialog.getByRole("heading", { name: "Confirm import" }),
    ).toBeVisible();
    await expect(dialog).toContainText("2 place rows ready to import.");

    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible({ timeout: 15_000 });
    await expectTallies(dialog, { Created: "2" });

    // The list behind the dialog was refetched.
    const aside = page.getByRole("complementary", { name: "Places" });
    const created = ["Corpus E2E Canyon One", "Corpus E2E Canyon Two"].map(
      (name) => aside.getByRole("button", { name, exact: true }),
    );
    for (const place of created) await expect(place).toBeVisible();

    await undoWhatWasImported(page, dialog);
    for (const place of created) await expect(place).toHaveCount(0);
  } finally {
    await undoWhatWasImported(page, dialog);
  }
});

test("a logbook: the match review, import, Undo", async ({ page }) => {
  const dialog = await openImportDialog(page);
  try {
    await dialog
      .locator("input[type=file]")
      .setInputFiles(corpus("logbooks/maintainer-logbook.csv"));

    await expect(
      dialog.getByRole("heading", { name: /^Logbook columns/ }),
    ).toBeVisible({ timeout: 15_000 });
    const roles = {
      Name: "name",
      Date: "date",
      Party: "appendNotes",
      Notes: "notes",
      "Total Canyons": "discard",
    };
    for (const [header, role] of Object.entries(roles)) {
      await expect(
        dialog.getByRole("combobox", { name: `What "${header}" is` }),
      ).toHaveValue(role);
    }
    // 03/02/2019 and 17/11/2019 settle it: day first.
    await expect(
      dialog.getByRole("combobox", { name: "Date format" }),
    ).toHaveValue("DD/MM/YYYY");

    // The golden: Grand, Jugglers, Yileen, Serendipity and Sarcophagus link on
    // their own; Rocky Creek, Wollangambe, Empres Falls and the unknown gully
    // need a decision.
    await next(dialog);
    await expect(
      dialog.getByRole("heading", { name: "Review matches" }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "Plus 5 more trips matched a place confidently",
    );
    for (const name of [
      "Rocky Creek",
      "Wollangambe",
      "Empres Falls",
      "Corpus Unknown Gully",
    ]) {
      await expect(
        dialog.getByRole("radiogroup", { name, exact: true }),
      ).toBeVisible();
    }
    // The misspelling has a best guess, and so does Rocky Creek (of two).
    await expect(
      dialog
        .getByRole("radiogroup", { name: "Empres Falls" })
        .getByRole("radio", { name: /Link to Empress Falls/ }),
    ).toBeChecked();

    // Keep the guesses; the two with none are discarded.
    await dialog.getByRole("button", { name: "Accept all guesses" }).click();
    for (const name of ["Wollangambe", "Corpus Unknown Gully"]) {
      await dialog
        .getByRole("radiogroup", { name })
        .getByRole("radio", { name: "Discard" })
        .check();
    }
    await next(dialog);
    await expect(dialog).toContainText("9 trips ready to import.");

    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(
      dialog.getByRole("heading", { name: "Import complete" }),
    ).toBeVisible({ timeout: 15_000 });
    // 10 rows, one with a date nobody can read, two discarded.
    await expectTallies(dialog, {
      Imported: "7",
      "Couldn't be read": "1",
      "Linked to a place": "7",
      Discarded: "2",
    });

    await undoWhatWasImported(page, dialog);
    await expect(
      page.getByText("Import undone — 7 trips removed."),
    ).toBeVisible();
  } finally {
    await undoWhatWasImported(page, dialog);
  }
});
