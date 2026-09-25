import { describe, expect, it } from "vitest";

import { formatBytes, formatMinutes } from "./format";

describe("formatBytes", () => {
  it("drops precision as the number grows", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1.6)).toBe("2 MB");
    expect(formatBytes(1024 ** 3 * 1.25)).toBe("1.3 GB");
  });

  it("never reports a real file as nothing", () => {
    // "0 KB" beside a row that plainly exists reads as a broken measurement.
    expect(formatBytes(1)).toBe("1 KB");
    expect(formatBytes(500)).toBe("1 KB");
  });

  it("reports genuinely nothing as zero", () => {
    expect(formatBytes(0)).toBe("0 KB");
  });
});

describe("formatMinutes", () => {
  it("says a short wait without a number", () => {
    expect(formatMinutes(30)).toBe("under a minute");
    expect(formatMinutes(89)).toBe("under a minute");
  });

  it("rounds to whole minutes, then hours and minutes", () => {
    expect(formatMinutes(1260)).toBe("about 21 min");
    expect(formatMinutes(3600 + 25 * 60)).toBe("about 1 h 25 min");
  });
});
