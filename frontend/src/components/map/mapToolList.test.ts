import { mapTools } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { webMapTools } from "./mapToolList";

// Logjam Web's tray is the shared declaration. Mutation: re-label or reorder a
// tool in `mapToolList.ts` and this goes red.
describe("webMapTools", () => {
  it("holds exactly the tools MAP_TOOLS gives Logjam Web, with its words", () => {
    const noop = { onSelect: () => {} };
    const tools = webMapTools({
      measure: noop,
      route: noop,
      place: noop,
      makeMap: { menu: [] },
    });
    expect(tools.map(({ id, label, icon }) => ({ id, label, icon }))).toEqual(
      mapTools("web"),
    );
  });
});
