import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The place page reads its route slot through the shared `placeRoute`, as
// Logjam GPS does (ADR 0020), so neither can say "No route yet" about a place
// the other shows a route for. Mutation that turns it red: put the panel back
// on its own `routes.find(... placeId ...)`.
describe("the place page's route section", () => {
  it("decides through the shared placeRoute", () => {
    const panel = readFileSync(
      "src/components/sidebar/panels/PlaceDetailPanel.tsx",
      "utf8",
    );
    expect(panel).toMatch(/\bplaceRoute\(/);
    expect(panel).not.toMatch(/route\.placeId === /);
  });
});
