import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DISMISS_DISTANCE,
  sheetPulled,
  sheetRelease,
  sheetReseats,
} from "./sheetPull";

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

// A pull the finger takes back. Android scrolls the CONTENT when a drag that
// pulled the sheet down turns upward, so how far the sheet is really down is
// the pull less what the content has scrolled since.
describe("sheetPulled", () => {
  it("is the pull when the content has not scrolled", () => {
    expect(sheetPulled({ pull: 200, scrolled: 0 })).toBe(200);
  });

  it("gives back what the finger took back", () => {
    expect(sheetPulled({ pull: 200, scrolled: 150 })).toBe(50);
  });

  it("stops at the open position, where the content starts to scroll", () => {
    expect(sheetPulled({ pull: 200, scrolled: 500 })).toBe(0);
  });

  it("is zero for a sheet at rest however far its content is scrolled", () => {
    expect(sheetPulled({ pull: 0, scrolled: 300 })).toBe(0);
  });

  // Red when the release reads the raw pull instead of `sheetPulled`: a sheet
  // dragged down 200pt and brought all the way back closed when let go.
  it("a pull taken back does not close the sheet", () => {
    const pulled = sheetPulled({ pull: 200, scrolled: 190 });
    expect(sheetRelease({ pulled, dragged: true })).toBe("snap");
  });
});

// The sheet rests at the END of its scroll, so it is put back there whenever
// its height changes. Not while it is closing: an owner empties its sheet as
// it closes, and re-seating the shrunken sheet threw away the pull the finger
// had left, so an empty shell jumped back up in the middle of the slide out.
describe("sheetReseats", () => {
  it("re-seats an open sheet nobody is dragging", () => {
    expect(sheetReseats({ visible: true, touching: false })).toBe(true);
  });

  it("leaves a sheet under a finger where the finger has it", () => {
    expect(sheetReseats({ visible: true, touching: true })).toBe(false);
  });

  // Red when the `visible` condition is dropped from `sheetReseats`.
  it("never re-seats a sheet that is closing", () => {
    expect(sheetReseats({ visible: false, touching: false })).toBe(false);
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
