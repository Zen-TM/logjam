import { describe, it, expect } from "vitest";
import { nextTopoName } from "./jobName";

describe("nextTopoName", () => {
  it("returns the base name when it is free", () => {
    expect(nextTopoName("Katoomba", [])).toBe("Katoomba");
    expect(nextTopoName("Katoomba", ["Wollangambe"])).toBe("Katoomba");
  });

  it("appends 2 when the base name is taken", () => {
    expect(nextTopoName("Katoomba", ["Katoomba"])).toBe("Katoomba 2");
  });

  it("skips to the first free suffix", () => {
    expect(nextTopoName("Katoomba", ["Katoomba", "Katoomba 2"])).toBe(
      "Katoomba 3",
    );
  });

  it("fills a gap left by a deleted job", () => {
    expect(nextTopoName("Katoomba", ["Katoomba", "Katoomba 3"])).toBe(
      "Katoomba 2",
    );
  });
});
