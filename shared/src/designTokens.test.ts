import { describe, expect, it } from "vitest";

import { FORM_RHYTHM, SPACE } from "./designTokens.js";

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
