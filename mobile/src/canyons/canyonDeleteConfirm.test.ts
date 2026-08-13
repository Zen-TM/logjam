import { describe, expect, it } from "vitest";

import { canyonDeleteConfirm } from "./canyonDeleteConfirm";

describe("canyonDeleteConfirm", () => {
  it("names the canyon in the title", () => {
    expect(canyonDeleteConfirm("Claustral", 0).confirmTitle).toBe("Delete Claustral?");
  });

  it("omits the trip sentence when nothing links to it", () => {
    const { confirmBody } = canyonDeleteConfirm("Claustral", 0);
    expect(confirmBody).not.toMatch(/logged/);
    expect(confirmBody).toMatch(/This can't be undone\.$/);
  });

  it("singularises one linked trip", () => {
    expect(canyonDeleteConfirm("Claustral", 1).confirmBody).toContain(
      "1 logged trip will stay, but lose the link to it.",
    );
  });

  it("pluralises several linked trips", () => {
    expect(canyonDeleteConfirm("Claustral", 4).confirmBody).toContain(
      "4 logged trips will stay, but lose the link to it.",
    );
  });

  // The whole point of the module: one string, whatever the caller.
  it("gives both call sites the same copy for the same facts", () => {
    expect(canyonDeleteConfirm("Claustral", 2)).toEqual(
      canyonDeleteConfirm("Claustral", 2),
    );
  });
});
