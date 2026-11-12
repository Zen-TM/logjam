import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DISMISS_DISTANCE,
  sheetHolds,
  sheetPinAfterQuiet,
  sheetPinAfterTouch,
  sheetPins,
  sheetPulled,
  sheetRelease,
  sheetReseats,
  sheetSeated,
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
// it closes, and re-seating the shrunken sheet throws away the pull the finger
// has left, so an empty shell jumps back up in the middle of the slide out.
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
// header.
it("the sheet's content hands its overscroll to the sheet", () => {
  const sheet = readFileSync(
    new URL("./BottomSheet.tsx", import.meta.url),
    "utf8",
  );
  expect(sheet).toMatch(/\bnestedScrollEnabled\b/);
});

// An owner empties its sheet in the render that closes it (no title, no rows,
// the keyboard on its way down), so a sheet that draws what it was handed
// slides out as an empty shell of another height.
describe("sheetHolds", () => {
  it("draws what its owner hands it while open", () => {
    expect(sheetHolds({ visible: true })).toBe(false);
  });

  // Red when `sheetHolds` returns false: a form dragged closed with the
  // keyboard up loses the keyboard's height on the way out.
  it("keeps what it last drew while it closes", () => {
    expect(sheetHolds({ visible: false })).toBe(true);
  });
});

// A component that returns null unmounts its BottomSheet, and a sheet that is
// gone cannot slide out. Red when an owner goes back to
// `if (!place) return null;` in place of `return closedSheet;`.
it("no sheet owner unmounts its sheet when its subject is cleared", () => {
  const src = new URL("../", import.meta.url);
  const offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
    // The kit's own sheet returns null once it has slid out.
    .filter((file) => file.endsWith("Sheet.tsx") && !file.startsWith("ui/"))
    .filter((file) =>
      /^\s*if \(!\w+(?: \|\| !\w+)*\) return null;$/m.test(
        readFileSync(new URL(file, src), "utf8"),
      ),
    );
  expect(offenders).toEqual([]);
});

// The sheet is put at its open position by a scroll, and the scroll cannot
// land until the sheet's size has reached the native view: starting the slide
// in earlier runs with the sheet a screen below its place, and the sheet then
// appears all at once or jumps as its size is corrected.
describe("sheetSeated", () => {
  const open = { content: 1500, viewport: 900, y: 600 };

  it("is seated at the end of its scroll", () => {
    expect(sheetSeated(open)).toBe(true);
  });

  // Red when `sheetSeated` stops comparing the offset with the end.
  it("is not seated short of the end", () => {
    expect(sheetSeated({ ...open, y: 0 })).toBe(false);
  });

  // Red when the `isFinite` condition is dropped: the offset is unknown
  // until the first scroll event, and unknown reads as seated.
  it("is not seated before anything has been reported", () => {
    expect(sheetSeated({ ...open, y: Number.POSITIVE_INFINITY })).toBe(false);
    expect(sheetSeated({ content: 0, viewport: 0, y: 0 })).toBe(false);
  });
});

// A drag that starts on content scrolled away from its top scrolls the content
// and stops at the top; it does not hand on to the sheet. A drag that starts at
// the top may.
describe("sheetPins", () => {
  it("pins a finger that went down on scrolled content", () => {
    expect(sheetPins({ scrolled: 40 })).toBe(true);
  });

  // Red when `sheetPins` returns true at the top: no sheet could be pulled
  // down by its content any more.
  it("does not pin a finger that went down at the top", () => {
    expect(sheetPins({ scrolled: 0 })).toBe(false);
  });

  // The drag as the sheet sees it: the finger goes down 300pt into the content,
  // drags down 500pt (the content takes 300, the hand-off takes the other 200),
  // and lets go. Red when `sheetPulled` ignores `pinned`: the sheet is then 200pt
  // down, and 80pt past the dismiss distance it closes.
  it("a drag that started away from the top never moves the sheet", () => {
    const pinned = sheetPins({ scrolled: 300 });
    for (const taken of [0, 100, 200]) {
      const pulled = sheetPulled({ pull: taken, scrolled: 0, pinned });
      expect(pulled).toBe(0);
      expect(sheetRelease({ pulled, dragged: true })).toBe("rest");
    }
  });

  it("a drag that started at the top still pulls the sheet down", () => {
    const pinned = sheetPins({ scrolled: 0 });
    expect(sheetPulled({ pull: 200, scrolled: 0, pinned })).toBe(200);
  });

  // Red when BottomSheet stops pinning from the touch that lands on the
  // content, or draws the pinned sheet lower by the hand-off.
  it("BottomSheet reads the pin from the content's touch and cancels the pull", () => {
    const sheet = readFileSync(
      new URL("./BottomSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(sheet).toMatch(/sheetPins\(\{\s*scrolled: viewport\.current\.y/);
    expect(sheet).toMatch(/Animated\.multiply\(pinned, pullNode\)/);
  });
});

// The sheet sits at the bottom of a dock whose height does not depend on it, so
// a taller tab grows the sheet upward in the same layout pass. Red when the
// spacer goes back to a fixed height: the dock then grows with the sheet, the
// sheet grows downward and is pulled up by a scroll a frame or more later.
it("the dock keeps one height whatever the sheet's", () => {
  const sheet = readFileSync(
    new URL("./BottomSheet.tsx", import.meta.url),
    "utf8",
  );
  expect(sheet).toMatch(/spacer: \{ flexGrow: 1 \}/);
  expect(sheet).toMatch(/contentContainerStyle=\{\{\s*minHeight: 2 \*/);
  expect(sheet).not.toMatch(/height: Math\.max\(SHEET_TRAVEL/);
});

// When the pin starts and ends over one touch.
describe("sheetPinAfterQuiet", () => {
  const pinned = { pinned: true, touching: false, dragged: true, pull: 0 };

  // Red when the `dragged` condition is dropped: a finger resting on scrolled
  // content for SETTLE_MS before its drag starts unpins the sheet, and the
  // drag then hands off to it.
  it("keeps the pin of a finger that has not started dragging", () => {
    expect(sheetPinAfterQuiet({ ...pinned, dragged: false })).toBe("keep");
  });

  it("keeps the pin under a finger that is dragging", () => {
    expect(sheetPinAfterQuiet({ ...pinned, touching: true, pull: 200 })).toBe(
      "keep",
    );
  });

  it("undoes the hand-off once the finger is up", () => {
    expect(sheetPinAfterQuiet({ ...pinned, pull: 200 })).toBe("undo");
  });

  it("unpins once the hand-off is undone", () => {
    expect(sheetPinAfterQuiet(pinned)).toBe("unpin");
  });

  it("has nothing to do for a sheet that is not pinned", () => {
    expect(sheetPinAfterQuiet({ ...pinned, pinned: false, pull: 200 })).toBe(
      "keep",
    );
  });
});

describe("sheetPinAfterTouch", () => {
  it("pins a finger on scrolled content", () => {
    expect(
      sheetPinAfterTouch({ startedAway: true, pinned: false, pull: 0 }),
    ).toBe(true);
  });

  it("frees the sheet for a finger at the top", () => {
    expect(
      sheetPinAfterTouch({ startedAway: false, pinned: true, pull: 0 }),
    ).toBe(false);
  });

  // Red when the pull is ignored: the sheet is drawn `pull` lower at once.
  it("stays pinned while the last hand-off is still being undone", () => {
    expect(
      sheetPinAfterTouch({ startedAway: false, pinned: true, pull: 200 }),
    ).toBe(true);
  });

  it("stays free when nothing was pinned", () => {
    expect(
      sheetPinAfterTouch({ startedAway: false, pinned: false, pull: 200 }),
    ).toBe(false);
  });
});

// Red when BottomSheet stops asking the two decisions above, or acts on a
// second finger.
it("BottomSheet takes the pin lifecycle from sheetPull and ignores a second finger", () => {
  const sheet = readFileSync(
    new URL("./BottomSheet.tsx", import.meta.url),
    "utf8",
  );
  expect(sheet.match(/sheetPinAfterQuiet\(/g)?.length).toBe(2);
  expect(sheet).toMatch(/sheetPinAfterTouch\(/);
  expect(sheet.match(/touches\.length > 1/g)?.length).toBe(2);
});
