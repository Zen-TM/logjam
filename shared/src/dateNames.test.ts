import { describe, expect, it } from "vitest";
import { SHORT_MONTHS, SHORT_WEEKDAYS } from "./dateNames.js";

describe("short date names", () => {
  // Mutation: drop or reorder a name, and every date after it reads wrong.
  it("index as Date#getDay and Date#getMonth count", () => {
    expect(SHORT_WEEKDAYS).toHaveLength(7);
    expect(SHORT_MONTHS).toHaveLength(12);
    // 1 January 2023 was a Sunday.
    for (let day = 0; day < 7; day++) {
      const date = new Date(2023, 0, 1 + day);
      expect(SHORT_WEEKDAYS[date.getDay()]).toBe(
        date.toLocaleDateString("en-AU", { weekday: "short" }),
      );
    }
    for (let month = 0; month < 12; month++) {
      const date = new Date(2023, month, 15);
      expect(SHORT_MONTHS[date.getMonth()]).toBe(
        date.toLocaleDateString("en-AU", { month: "short" }).slice(0, 3),
      );
    }
  });
});
