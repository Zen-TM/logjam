import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLACE_FORM, TRIP_FORM } from "@logjam/shared";

// THE PLACE FORM AND THE TRIP FORM DRAW THEIR WORDS FROM THEIR CONTRACTS.
//
// A label, hint, title, submit label or done toast typed into Logjam Web's dialogs
// is a second copy of a word `PLACE_FORM` or `TRIP_FORM` holds, and the two
// clients drift apart again. Mutation: type `label="Name"` back into
// PlaceDialog.tsx.
const FORMS = [
  ["PlaceDialog.tsx", PLACE_FORM],
  ["TripLogDialog.tsx", TRIP_FORM],
] as const;

describe.each(FORMS)("%s", (file, contract) => {
  const source = readFileSync(join(__dirname, ".", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  it.each(Object.entries(contract.copy))(
    "keeps %s in the contract",
    (_key, words) => {
      expect(source).not.toContain(`"${words}"`);
    },
  );
});
