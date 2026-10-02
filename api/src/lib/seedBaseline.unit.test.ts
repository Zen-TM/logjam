import { describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

import { extraRows, seededDrift } from "../__tests__/_seedBaseline";

describe("seededDrift", () => {
  const base = { users: { a: "h1", b: "h2" }, places: { p: "h3" } };

  it("ignores extra rows: the sweep removes those", () => {
    expect(
      seededDrift(base, { ...base, users: { ...base.users, c: "x" } }),
    ).toEqual([]);
  });

  it("names the table of a modified or deleted seeded row", () => {
    expect(
      seededDrift(base, { users: { a: "CHANGED" }, places: { p: "h3" } }),
    ).toEqual([
      { table: "users", key: "a", kind: "modified" },
      { table: "users", key: "b", kind: "deleted" },
    ]);
  });

  it("reports a table that vanished", () => {
    expect(seededDrift(base, { users: base.users })).toEqual([
      { table: "places", key: "p", kind: "deleted" },
    ]);
  });

  it("extraRows names the table of a row the sweep left behind", () => {
    expect(extraRows(base, { ...base, places: { p: "h3", q: "x" } })).toEqual([
      { table: "places", key: "q", kind: "extra" },
    ]);
  });
});
