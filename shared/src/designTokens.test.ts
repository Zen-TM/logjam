import { describe, expect, it } from "vitest";

import { FONT, FORM_RHYTHM, SPACE, TEXT_ROLES } from "./designTokens.js";

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
  it("carries no colour: size, weight, leading and capitals only", () => {
    for (const [name, role] of Object.entries(TEXT_ROLES)) {
      const extra = Object.keys(role).filter(
        (k) => !["size", "weight", "leading", "uppercase"].includes(k),
      );
      expect(extra, `${name} carries ${extra.join(", ")}`).toEqual([]);
    }
  });
});
