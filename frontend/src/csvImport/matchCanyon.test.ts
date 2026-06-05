import { describe, it, expect } from "vitest";
import { matchCanyonByName } from "./matchCanyon";
import type { TCanyon } from "../canyonUtils";

function canyon(name: string, altNames: string[] = [], id = name): TCanyon {
  return { id, name, altNames, latitude: 0, longitude: 0 } as unknown as TCanyon;
}

describe("matchCanyonByName", () => {
  it("returns a single exact (normalized) match", () => {
    const result = matchCanyonByName("Empress Canyon", [
      canyon("Empress Canyon"),
      canyon("Claustral Canyon"),
    ]);
    expect(result.kind).toBe("match");
    if (result.kind === "match") expect(result.canyon.name).toBe("Empress Canyon");
  });

  it("matches against an alt name", () => {
    const result = matchCanyonByName("The Empress", [canyon("Empress Canyon", ["The Empress"])]);
    expect(result.kind).toBe("match");
  });

  it("returns ambiguous when more than one exact match exists", () => {
    const result = matchCanyonByName("Twin", [canyon("Twin", [], "a"), canyon("Twin", [], "b")]);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") expect(result.canyons).toHaveLength(2);
  });

  it("falls back to a fuzzy substring match", () => {
    const result = matchCanyonByName("Empress", [canyon("Empress Falls Creek")]);
    expect(result.kind).toBe("match");
  });

  it("returns none when nothing matches", () => {
    const result = matchCanyonByName("Nonexistent", [canyon("Empress Canyon")]);
    expect(result.kind).toBe("none");
  });
});
