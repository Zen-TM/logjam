import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The place page reads its route slot through the shared `placeRoute`, as
// Logjam Web does (ADR 0020). Mutation that turns it red: put the screen back
// on its own `routes.find(... placeId ...)`.
describe("the place page's route section", () => {
  it("decides through the shared placeRoute", () => {
    const screen = readFileSync(
      new URL("./PlaceDetailScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(screen).toMatch(/\bplaceRoute\(/);
    expect(screen).not.toMatch(/route\.placeId === placeId/);
  });
});
