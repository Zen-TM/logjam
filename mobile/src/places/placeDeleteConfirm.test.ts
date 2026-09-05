import { describe, expect, it } from "vitest";

import { placeDeleteConfirm } from "./placeDeleteConfirm";

describe("placeDeleteConfirm", () => {
  it("names the place in the title", () => {
    expect(placeDeleteConfirm("Claustral", 0).confirmTitle).toBe("Delete Claustral?");
  });

  it("omits the trip sentence when nothing links to it", () => {
    const { confirmBody } = placeDeleteConfirm("Claustral", 0);
    expect(confirmBody).not.toMatch(/logged/);
    expect(confirmBody).toMatch(/This can't be undone\.$/);
  });

  it("singularises one linked trip", () => {
    expect(placeDeleteConfirm("Claustral", 1).confirmBody).toContain(
      "1 logged trip will stay, but lose the link to it.",
    );
  });

  it("pluralises several linked trips", () => {
    expect(placeDeleteConfirm("Claustral", 4).confirmBody).toContain(
      "4 logged trips will stay, but lose the link to it.",
    );
  });

  // The whole point of the module: one string, whatever the caller.
  it("gives both call sites the same copy for the same facts", () => {
    expect(placeDeleteConfirm("Claustral", 2)).toEqual(
      placeDeleteConfirm("Claustral", 2),
    );
  });
});
