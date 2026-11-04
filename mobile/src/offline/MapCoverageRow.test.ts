import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coverageSubtitle } from "./coverageSubtitle";

describe("coverageSubtitle", () => {
  // Mutation: return the online sentence when offline, and the dimmed row
  // gives no reason.
  it("says why the row is dim when there is no connection", () => {
    expect(coverageSubtitle(false, "Topo")).toContain("Needs a connection");
    expect(coverageSubtitle(true, "Topo")).not.toContain("Needs a connection");
  });
  // Mutation: drop the "No offline map" sentence from either branch.
  it("always says what is missing, and names the basemap while online", () => {
    expect(coverageSubtitle(true, "Topo")).toBe(
      "No offline map for this area · Topo",
    );
    expect(coverageSubtitle(true, undefined)).toBe(
      "No offline map for this area",
    );
    expect(coverageSubtitle(false, "Topo")).toMatch(
      /^No offline map for this area/,
    );
  });
});

// The component itself draws with no renderer in this suite, so its shape is
// read from source. Mutation: put a `<Button` or `CardActions` back in the
// row's footer, or draw the subtitle without `coverageSubtitle`.
describe("MapCoverageRow", () => {
  it("is one pressable card row whose subtitle is coverageSubtitle", () => {
    const source = readFileSync(
      new URL("./MapCoverageRow.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/<Button|CardActions/);
    expect(source).toContain(
      "subtitle={coverageSubtitle(online, basemapName)}",
    );
    expect(source).toMatch(/disabled=\{!online\}/);
  });
});
