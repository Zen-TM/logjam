import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// THE TOP NOTICE STACK READS IN ONE ORDER (shared/DESIGN.md §15): the notice
// about data being lost now (`tone="critical"`), then the navigation readout,
// then everything else. A recording that cannot save outranks a distance.
//
// Mutations that turn it red: move the `<NavReadout` block above the
// `tone="critical"` notice, or below the first `<DraftToolPanel`; draw a second
// layer for the readout outside the `noticeStack` view.
const source = readFileSync(
  new URL("./MapScreen.tsx", import.meta.url),
  "utf8",
);
const stack = source.slice(source.indexOf("styles.noticeStack,"));

describe("the notice stack", () => {
  it("puts the critical notice, then the navigation readout, first", () => {
    const critical = stack.indexOf('tone="critical"');
    const navigation = stack.indexOf("<NavReadout");
    const firstOther = Math.min(
      ...['<Notice icon="offline"', "<DraftToolPanel", "<SensorMarkButton"]
        .map((marker) => stack.indexOf(marker))
        .filter((at) => at >= 0),
    );
    expect(critical).toBeGreaterThan(-1);
    expect(critical).toBeLessThan(navigation);
    expect(navigation).toBeLessThan(firstOther);
  });

  it("draws the readout once, inside the stack", () => {
    expect(source.match(/<NavReadout/g)).toHaveLength(1);
    expect(source.indexOf("<NavReadout")).toBeGreaterThan(
      source.indexOf("styles.noticeStack,"),
    );
  });
});
