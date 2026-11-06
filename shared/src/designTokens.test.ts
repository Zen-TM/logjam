import { describe, expect, it } from "vitest";

import {
  DRAFT_LINE,
  FONT,
  FORM_RHYTHM,
  ICON_SIZE,
  OPACITY,
  SPACE,
  TEXT_ROLES,
  TOAST_MS,
  WASH,
} from "./designTokens.js";

describe("FORM_RHYTHM", () => {
  // A label hugs its control, fields are a field apart, and a heading divides
  // two groups, so it stands further off than the fields around it
  // (shared/DESIGN.md §2). Mutation that turns it red: set `field` to
  // `SPACE["2"]`, or `label` to `SPACE["1"]`.
  it("grows from label to field to section", () => {
    expect(FORM_RHYTHM.label).toBeLessThan(FORM_RHYTHM.field);
    expect(FORM_RHYTHM.field).toBeLessThan(FORM_RHYTHM.section);
  });

  it("stands on the space scale", () => {
    const steps = Object.values(SPACE) as number[];
    for (const gap of Object.values(FORM_RHYTHM)) expect(steps).toContain(gap);
  });
});

describe("TEXT_ROLES", () => {
  // A role is a kind of text that no other role draws the same: two roles with
  // the same values are one role under two names, and the next contributor
  // cannot tell which to take. Mutation that turns it red: give `detail` the
  // size and weight of `meta`.
  it("holds no two roles with the same size, weight, leading and case", () => {
    const seen = new Map<string, string>();
    for (const [name, role] of Object.entries(TEXT_ROLES)) {
      const key = JSON.stringify([
        role.size,
        role.weight,
        "leading" in role,
        "uppercase" in role,
        "tabular" in role,
      ]);
      expect(
        seen.get(key),
        `${name} is ${seen.get(key)} again`,
      ).toBeUndefined();
      seen.set(key, name);
    }
  });

  // A step the web scale lacks would be a role one client cannot draw.
  it("names the same steps on both clients", () => {
    expect(Object.keys(FONT.gps)).toEqual(Object.keys(FONT.web));
  });

  // Mutation: add `muted: true` to a role.
  it("carries no colour: size, weight, leading, capitals and figure width only", () => {
    for (const [name, role] of Object.entries(TEXT_ROLES)) {
      const extra = Object.keys(role).filter(
        (k) =>
          !["size", "weight", "leading", "uppercase", "tabular"].includes(k),
      );
      expect(extra, `${name} carries ${extra.join(", ")}`).toEqual([]);
    }
  });
});

describe("DRAFT_LINE", () => {
  // The casing must show beyond the core on both sides, and a measure dash must
  // be longer than it is wide, or the line is a row of dots again. Mutation
  // that turns it red: set `casingWidth` to `coreWidth`, or `measureDash[0]`
  // to 0.1.
  it("casts a casing wider than the core, with dashes not dots", () => {
    expect(DRAFT_LINE.casingWidth).toBeGreaterThanOrEqual(
      DRAFT_LINE.coreWidth + 3,
    );
    expect(DRAFT_LINE.measureDash[0]).toBeGreaterThanOrEqual(1.5);
  });

  // Mutation: drop the core/casing scaling from `measureCasingDash` and the
  // casing's dashes drift off the core's, a rim on one end and none on the other.
  it("dashes a measurement's casing on the core's pixels", () => {
    const px = (dash: readonly number[], width: number) =>
      dash.map((d) => d * width);
    expect(
      px(DRAFT_LINE.measureCasingDash, DRAFT_LINE.measureCasingWidth),
    ).toEqual(px(DRAFT_LINE.measureDash, DRAFT_LINE.coreWidth));
    expect(DRAFT_LINE.measureCasingWidth).toBeGreaterThan(DRAFT_LINE.coreWidth);
  });
});

describe("toast, wash and icon tokens", () => {
  // An error must outlast a done toast by enough to be read (shared/DESIGN.md
  // §11). Mutation that turns it red: set `TOAST_MS.error` to 5000.
  it("keeps an error toast at least twice as long as a done one", () => {
    expect(TOAST_MS.error).toBeGreaterThanOrEqual(2 * TOAST_MS.done);
  });

  // A wash is a tint that stays under a press, or a press would not show on
  // it. Mutation: set `WASH.strong` to 0.7, or reorder two steps.
  it("ascends in WASH and stays under a press", () => {
    const steps = Object.values(WASH);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(steps.length);
    for (const step of steps) expect(step).toBeLessThan(OPACITY.pressed);
  });

  // Mutation: set `ICON_SIZE.md` to 18.
  it("draws icons on a 4px grid", () => {
    for (const px of Object.values(ICON_SIZE)) expect(px % 4).toBe(0);
  });
});
