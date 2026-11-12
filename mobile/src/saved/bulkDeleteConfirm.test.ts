import { describe, expect, it } from "vitest";

import { bulkDeleteConfirmBody, bulkDeleteCounts } from "./bulkDeleteConfirm";

// This copy is the only warning before an irreversible delete, and the counts
// it reads from vary independently — so every combination is pinned as a whole
// sentence, which is the only way a template artefact ("1 of them are…") shows
// up in review rather than in a dialog.
describe("bulkDeleteConfirmBody", () => {
  it("uses a pronoun for one file, and names the space freed", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 1,
        syncedCount: 0,
        onDeviceBytes: 684032,
      }),
    ).toBe(
      "It is deleted from this phone, freeing 668 KB. This can't be undone.",
    );
  });

  it("drops the size when the selection costs no disk", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 3,
        syncedCount: 0,
        onDeviceBytes: 0,
      }),
    ).toBe("They are deleted from this phone. This can't be undone.");
  });

  it("says only the account consequence when nothing is a file", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 0,
        syncedCount: 4,
        onDeviceBytes: 0,
      }),
    ).toBe(
      "They are removed from your account and from any friends they're shared with. This can't be undone.",
    );
  });

  it("splits a mixed selection into two clauses that agree in number", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 1,
        syncedCount: 4,
        onDeviceBytes: 684032,
      }),
    ).toBe(
      "4 of them are synced files and routes, removed from your account and from any friends they're shared with. The other one is deleted from this phone, freeing 668 KB. This can't be undone.",
    );
  });

  it("keeps both halves singular when there is one of each", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 1,
        syncedCount: 1,
        onDeviceBytes: 0,
      }),
    ).toBe(
      "One of them is a synced file or route, removed from your account and from any friends they're shared with. The other one is deleted from this phone. This can't be undone.",
    );
  });

  it("pluralises the on-device half", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 2,
        syncedCount: 1,
        onDeviceBytes: 2097152,
      }),
    ).toBe(
      "One of them is a synced file or route, removed from your account and from any friends they're shared with. The other 2 are deleted from this phone, freeing 2 MB. This can't be undone.",
    );
  });
});

// The split comes from each item's own delete descriptor, never from its
// category: an import and a recording are files that also live in the account.
// Mutation: count `category === "route"` again instead of `delete.synced`.
describe("bulkDeleteCounts", () => {
  it("counts every account-reaching delete as synced, whatever its kind", () => {
    expect(
      bulkDeleteCounts([
        { delete: { synced: true } }, // import
        { delete: { synced: true } }, // recording
        { delete: { synced: false } }, // region
        {},
      ]),
    ).toEqual({ syncedCount: 2, onDeviceCount: 1 });
  });

  it("words a mixed selection as synced files and routes", () => {
    expect(
      bulkDeleteConfirmBody({
        onDeviceCount: 1,
        syncedCount: 2,
        onDeviceBytes: 0,
      }),
    ).toBe(
      "2 of them are synced files and routes, removed from your account and from any friends they're shared with. The other one is deleted from this phone. This can't be undone.",
    );
  });
});
