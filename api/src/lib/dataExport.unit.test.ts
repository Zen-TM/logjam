// The completeness guard for "Download my data" (lib/dataExport.ts).
//
// privacy.html tells users the export is a copy of the personal information we
// hold. The export's failure mode is silence: a new table of user data is
// simply absent from it. So the schema is the ground truth, as in
// placeVisibility.unit.test.ts: every model in schema.prisma must be covered by
// an export section, carried as the `user` object, or listed in
// NOT_EXPORTED_MODELS with a reason.
//
// Mutation that turns it red: delete the `routes` section (or any section) from
// EXPORT_SECTIONS, or add a model to schema.prisma without classifying it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

const { EXPORT_SECTIONS, EXPORTED_AS_USER, NOT_EXPORTED_MODELS } = await import(
  "./dataExport"
);

const schema = readFileSync(
  join(import.meta.dirname, "..", "..", "prisma", "schema.prisma"),
  "utf8",
);

const schemaModels = [...schema.matchAll(/^model (\w+) \{$/gm)].map(
  (match) => match[1],
);

const exportedModels = new Set<string>([
  ...EXPORTED_AS_USER,
  ...Object.values(EXPORT_SECTIONS).flatMap((section) => section.models),
]);

describe("data export coverage", () => {
  it("reads the models out of schema.prisma", () => {
    // A parse that found nothing would pass every check below.
    expect(schemaModels).toContain("Place");
    expect(schemaModels.length).toBeGreaterThan(10);
  });

  it("classifies every schema model as exported or not", () => {
    const unclassified = schemaModels.filter(
      (model) => !exportedModels.has(model) && !(model in NOT_EXPORTED_MODELS),
    );
    expect(unclassified).toEqual([]);
  });

  it("never both exports a model and gives a reason for leaving it out", () => {
    const both = Object.keys(NOT_EXPORTED_MODELS).filter((model) =>
      exportedModels.has(model),
    );
    expect(both).toEqual([]);
  });

  it("names only models that exist", () => {
    const unknown = [
      ...exportedModels,
      ...Object.keys(NOT_EXPORTED_MODELS),
    ].filter((model) => !schemaModels.includes(model));
    expect(unknown).toEqual([]);
  });
});
