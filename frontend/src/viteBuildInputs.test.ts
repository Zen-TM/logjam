// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildInputs } from "../vite.config";

// Mutation: add geopdf-bench.html to every mode's inputs (the dev-only bench
// page would ship), or drop it from bench mode (the bench cannot be timed
// from a built bundle).
describe("buildInputs", () => {
  it("builds the GeoPDF bench page in bench mode only", () => {
    const pages = (mode: string) =>
      Object.values(buildInputs(mode)).map((p) => p.split("/").pop());
    expect(pages("production")).toEqual(["index.html"]);
    expect(pages("development")).toEqual(["index.html"]);
    expect(pages("bench")).toEqual(["index.html", "geopdf-bench.html"]);
  });
});
