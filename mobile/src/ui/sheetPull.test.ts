import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DISMISS_DISTANCE, sheetRelease } from "./sheetPull";

describe("sheetRelease", () => {
  it("leaves a sheet at rest alone", () => {
    expect(sheetRelease({ pulled: 0, dragged: true })).toBe("rest");
  });

  it("springs back from a short pull", () => {
    expect(sheetRelease({ pulled: DISMISS_DISTANCE, dragged: true })).toBe(
      "snap",
    );
  });

  it("closes past the dismiss distance", () => {
    expect(sheetRelease({ pulled: DISMISS_DISTANCE + 1, dragged: true })).toBe(
      "close",
    );
  });

  // Red when the `dragged` condition is dropped from `sheetRelease`: a sheet
  // that grows (the keyboard, a sub-mode) sits below its rest position for a
  // frame with no finger involved, and would close itself.
  it("never closes a sheet nobody dragged", () => {
    expect(sheetRelease({ pulled: 600, dragged: false })).toBe("snap");
  });
});

// The hand-off from scrolling a sheet's content to dragging the sheet is
// Android nested scrolling, and it is one prop. Red when `nestedScrollEnabled`
// is deleted from BottomSheet.tsx: a scrollable sheet then drags only by its
// header, which is the bug this replaced.
it("the sheet's content hands its overscroll to the sheet", () => {
  const sheet = readFileSync(
    new URL("./BottomSheet.tsx", import.meta.url),
    "utf8",
  );
  expect(sheet).toMatch(/\bnestedScrollEnabled\b/);
});
