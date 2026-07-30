import { describe, expect, it } from "vitest";

import { formatBytes } from "./format";

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
