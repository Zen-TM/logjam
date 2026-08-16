import { describe, expect, it } from "vitest";

import { bulkDeleteConfirmBody } from "./bulkDeleteConfirm";

// This copy is the only warning before an irreversible delete, and the counts
// it reads from vary independently — so every combination is pinned as a whole
// sentence, which is the only way a template artefact ("1 of them are…") shows
// up in review rather than in a dialog.
describe("bulkDeleteConfirmBody", () => {
  it("uses a pronoun for one file, and names the space freed", () => {
    expect(
      bulkDeleteConfirmBody({ onDeviceCount: 1, syncedCount: 0, onDeviceBytes: 684032 }),
    ).toBe("It is deleted from this phone, freeing 668 KB. This can't be undone.");
  });

  it("drops the size when the selection costs no disk", () => {
    expect(
      bulkDeleteConfirmBody({ onDeviceCount: 3, syncedCount: 0, onDeviceBytes: 0 }),
    ).toBe("They are deleted from this phone. This can't be undone.");
  });

  it("says only the account consequence when nothing is a file", () => {
    expect(
      bulkDeleteConfirmBody({ onDeviceCount: 0, syncedCount: 4, onDeviceBytes: 0 }),
    ).toBe(
      "They are removed from every device on your account, and from anyone you shared their canyons with. This can't be undone.",
    );
  });

  it("splits a mixed selection into two clauses that agree in number", () => {
    expect(
      bulkDeleteConfirmBody({ onDeviceCount: 1, syncedCount: 4, onDeviceBytes: 684032 }),
    ).toBe(
      "4 of them are routes and waypoints, removed from every device on your account, and from anyone you shared their canyons with. The other one is deleted from this phone, freeing 668 KB. This can't be undone.",
    );
  });

  it("keeps both halves singular when there is one of each", () => {
    expect(
      bulkDeleteConfirmBody({ onDeviceCount: 1, syncedCount: 1, onDeviceBytes: 0 }),
    ).toBe(
      "One of them is a route or waypoint, removed from every device on your account, and from anyone you shared their canyons with. The other one is deleted from this phone. This can't be undone.",
    );
  });

  it("pluralises the on-device half", () => {
    expect(
      bulkDeleteConfirmBody({ onDeviceCount: 2, syncedCount: 1, onDeviceBytes: 2097152 }),
    ).toBe(
      "One of them is a route or waypoint, removed from every device on your account, and from anyone you shared their canyons with. The other 2 are deleted from this phone, freeing 2 MB. This can't be undone.",
    );
  });
});
