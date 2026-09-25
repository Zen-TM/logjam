import { describe, expect, it } from "vitest";

import { describeLocalData, linkConfirmationMessage } from "./linkAccountCopy";

describe("describeLocalData", () => {
  it("joins three kinds with commas and a final 'and'", () => {
    expect(describeLocalData({ places: 42, trips: 18, media: 310 })).toBe(
      "42 places, 18 trips and 310 photos",
    );
  });

  it("drops empty kinds rather than reporting zeros", () => {
    expect(describeLocalData({ places: 0, trips: 18, media: 0 })).toBe("18 trips");
    expect(describeLocalData({ places: 3, trips: 0, media: 9 })).toBe(
      "3 places and 9 photos",
    );
  });

  it("singularises", () => {
    expect(describeLocalData({ places: 1, trips: 1, media: 1 })).toBe(
      "1 place, 1 trip and 1 photo",
    );
  });

  it("returns null when there is nothing on the device", () => {
    expect(describeLocalData({ places: 0, trips: 0, media: 0 })).toBeNull();
  });
});

describe("linkConfirmationMessage", () => {
  it("is null with nothing to merge, so the caller can skip the prompt", () => {
    expect(linkConfirmationMessage({ places: 0, trips: 0, media: 0 })).toBeNull();
  });

  it("states what moves and that it is irreversible", () => {
    const message = linkConfirmationMessage({ places: 5, trips: 2, media: 0 });
    expect(message).toContain("5 places and 2 trips");
    expect(message).toContain("can't be undone");
  });

  it("omits the slow-upload warning for a small photo count", () => {
    const message = linkConfirmationMessage({ places: 1, trips: 0, media: 3 });
    expect(message).not.toContain("take a while");
  });

  it("warns about duration once the photo backlog is large", () => {
    const message = linkConfirmationMessage({ places: 1, trips: 0, media: 300 });
    expect(message).toContain("take a while");
  });
});
