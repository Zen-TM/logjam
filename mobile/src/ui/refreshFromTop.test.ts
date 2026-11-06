import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { refreshPinAfter } from "./refreshFromTop";

describe("refreshPinAfter", () => {
  it("leaves a drag that began at the top free to refresh", () => {
    expect(refreshPinAfter("down", { pinned: false, scrolled: 0 })).toBe(false);
  });

  // Red when `down` stops reading the offset: a drag that starts scrolled down
  // and reaches the top would arm the refresh.
  it("holds off a drag that began scrolled down", () => {
    expect(refreshPinAfter("down", { pinned: false, scrolled: 400 })).toBe(
      true,
    );
  });

  // Red when `scroll` stops pinning: a drag that began at the top, went down
  // the list and came back would arm the refresh.
  it("holds off a drag that leaves the top", () => {
    expect(refreshPinAfter("scroll", { pinned: false, scrolled: 20 })).toBe(
      true,
    );
  });

  // Red when `scroll` unpins on reaching the top: the drag that scrolled down
  // reaches the top again and arms the refresh.
  it("stays held off when the same drag returns to the top", () => {
    expect(refreshPinAfter("scroll", { pinned: true, scrolled: 0 })).toBe(true);
  });

  it("frees the list when the finger lifts", () => {
    expect(refreshPinAfter("up", { pinned: true, scrolled: 400 })).toBe(false);
  });
});

// Red when a screen gives its RefreshControl back to the native default: its
// pull then arms from a drag that started scrolled down.
it("every RefreshControl is driven by useRefreshFromTop", () => {
  const src = new URL("../", import.meta.url);
  const offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx$/.test(file) && !file.includes(".test."))
    .filter((file) => {
      const text = readFileSync(new URL(file, src), "utf8");
      return (
        text.includes("<RefreshControl") &&
        !(
          text.includes("useRefreshFromTop()") &&
          text.includes("scrollProps}") &&
          /enabled=\{[^}]*pull\.enabled/.test(text)
        )
      );
    });
  expect(offenders).toEqual([]);
});
