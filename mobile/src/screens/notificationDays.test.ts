import { describe, expect, it } from "vitest";

import type { TNotification } from "../api/types";
import { groupNotificationsByDay } from "./notificationLabel";

/** Local-midnight-relative helper: builds an instant N hours before `now`. */
function at(iso: string): TNotification {
  return { id: iso, type: "canyon_shared", payload: {}, read: false, createdAt: iso };
}

// A fixed LOCAL wall-clock "now". The grouping is about the user's calendar day,
// so the test has to think in local time exactly as the code does.
const NOW = new Date(2026, 6, 30, 10, 0, 0); // 30 Jul 2026, 10:00 local

function localIso(year: number, month: number, day: number, hour: number): string {
  return new Date(year, month, day, hour).toISOString();
}

describe("groupNotificationsByDay", () => {
  it("labels the user's own today and yesterday", () => {
    const sections = groupNotificationsByDay(
      [
        at(localIso(2026, 6, 30, 9)),
        at(localIso(2026, 6, 30, 1)),
        at(localIso(2026, 6, 29, 20)),
      ],
      NOW,
    );
    expect(sections.map((section) => section.title)).toEqual(["Today", "Yesterday"]);
    expect(sections[0].data).toHaveLength(2);
    expect(sections[1].data).toHaveLength(1);
  });

  it("keeps an early-morning local time in today", () => {
    // 00:30 AEST is the previous day in UTC. Reading the day in UTC would file
    // this morning's notification under "Yesterday" (DESIGN.md §11).
    const sections = groupNotificationsByDay([at(localIso(2026, 6, 30, 0))], NOW);
    expect(sections[0].title).toBe("Today");
  });

  it("preserves the order it was given", () => {
    // The server sends newest-first; a section must never reorder the list.
    const first = at(localIso(2026, 6, 30, 9));
    const second = at(localIso(2026, 6, 30, 8));
    const sections = groupNotificationsByDay([first, second], NOW);
    expect(sections[0].data.map((n) => n.id)).toEqual([first.id, second.id]);
  });

  it("starts a new section when a day repeats after a gap", () => {
    // Grouping RUNS, not keys: if the server ever sent an out-of-order list, the
    // display must show what it was given rather than silently merging days.
    const sections = groupNotificationsByDay(
      [
        at(localIso(2026, 6, 30, 9)),
        at(localIso(2026, 6, 28, 9)),
        at(localIso(2026, 6, 30, 8)),
      ],
      NOW,
    );
    expect(sections).toHaveLength(3);
    // The middle title is a formatted date — locale-dependent by design (it
    // follows the device), so assert the shape rather than one locale's spelling.
    expect(sections[0].title).toBe("Today");
    expect(sections[1].title).toContain("28");
    expect(sections[1].title).not.toBe("Today");
    expect(sections[2].title).toBe("Today");
  });

  it("gives an unparseable timestamp a home rather than dropping it", () => {
    const sections = groupNotificationsByDay([at("not a date")], NOW);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Unknown date");
    expect(sections[0].data).toHaveLength(1);
  });

  it("returns nothing for nothing", () => {
    expect(groupNotificationsByDay([], NOW)).toEqual([]);
  });
});
