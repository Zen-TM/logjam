import { describe, it, expect } from "vitest";
import type { FriendShareRow } from "@logjam/shared";

import {
  buildShareCards,
  copyConfirm,
  copyOutcomeMessage,
  removeAllConfirm,
  removeOutcomeMessage,
  removeRowSubtitle,
  shareSelectionCountLabel,
  unshareAllConfirm,
  unshareOutcomeMessage,
} from "./friendShareRows";

const FRIEND = "bob";

function row(
  entityType: FriendShareRow["entityType"],
  entityId: string,
  name: string | null = "Thing",
  alsoViaCanyon = false,
): FriendShareRow {
  return {
    entityType,
    entityId,
    name,
    sharedAt: "2026-08-12T04:00:00.000Z",
    ...(alsoViaCanyon ? { alsoViaCanyon: true as const } : {}),
  };
}

const CANYON = row("canyon", "c1", "Claustral");
const WAYPOINT = row("waypoint", "w1", "Car park");
const TOPO = row("topoJob", "t1", null);

describe("buildShareCards", () => {
  it("labels a row by kind and grant date, kind first", () => {
    const [card] = buildShareCards([CANYON], {
      direction: "theySee",
      friendName: FRIEND,
    });
    expect(card.title).toBe("Claustral");
    expect(card.subtitle).toMatch(/^Canyon · shared /);
    expect(card.icon).toBe("map-pin");
  });

  // An untitled job still needs something to tap. The wording comes from
  // `shareRowTitle` in shared, so both clients say the same thing.
  it("names an untitled job rather than rendering an empty row", () => {
    const [card] = buildShareCards([TOPO], {
      direction: "theySee",
      friendName: FRIEND,
    });
    expect(card.title).toBe("Untitled topo");
  });

  // My own grants: there is nothing to copy (it is already mine) and nothing to
  // remove (I am not the recipient). The forward direction's verbs are share-on
  // and unshare, which every row supports.
  it("offers neither copy nor remove in the forward direction", () => {
    const cards = buildShareCards([CANYON, WAYPOINT], {
      direction: "theySee",
      friendName: FRIEND,
    });
    expect(cards.map((card) => card.copyable)).toEqual([false, false]);
    expect(cards.map((card) => card.removable)).toEqual([false, false]);
  });

  it("offers copy on a received canyon and not on a received waypoint", () => {
    const cards = buildShareCards([CANYON, WAYPOINT], {
      direction: "youSee",
      friendName: FRIEND,
    });
    expect(cards[0].copyable).toBe(true);
    expect(cards[1].copyable).toBe(false);
    // Removable either way — copy is the extra verb, not the gate.
    expect(cards.map((card) => card.removable)).toEqual([true, true]);
  });

  // THE TRAP: a waypoint shared directly AND linked to a canyon this friend
  // also shared. Revoking the direct arm leaves the canyon arm standing, so the
  // row would disappear and come back on the next pull — a Remove that appears
  // to work is worse than one that is absent with a reason.
  it("withholds Remove from a row that also rides a shared canyon, with the reason", () => {
    const [card] = buildShareCards([row("waypoint", "w1", "Car park", true)], {
      direction: "youSee",
      friendName: FRIEND,
    });
    expect(card.removable).toBe(false);
    expect(card.blockedReason).toContain("came with a canyon bob shared");
  });

  // The same key in the forward direction is meaningless — those rows are mine.
  // My own rows are not something I could lose access to, so the flag — which
  // the server only ever sets on received rows — means nothing here.
  it("ignores the flag in the forward direction", () => {
    const [card] = buildShareCards([row("waypoint", "w1", "Car park", true)], {
      direction: "theySee",
      friendName: FRIEND,
    });
    expect(card.blockedReason).toBeUndefined();
  });
});

// The bar's buttons are glyphs, so the count line is the only place a
// subset-acting verb can state its subset before the press.
describe("shareSelectionCountLabel", () => {
  const received = (rows: FriendShareRow[]) =>
    buildShareCards(rows, { direction: "youSee", friendName: FRIEND });

  it("is a plain count in the forward direction", () => {
    const cards = buildShareCards([CANYON, WAYPOINT], {
      direction: "theySee",
      friendName: FRIEND,
    });
    expect(shareSelectionCountLabel(cards, "theySee")).toBe("2 selected");
  });

  it("tallies the copyable subset when it differs from the total", () => {
    expect(shareSelectionCountLabel(received([CANYON, WAYPOINT]), "youSee")).toBe(
      "2 selected · 1 copyable",
    );
  });

  // "3 selected · 3 removable" is noise; the tally exists for the case where a
  // verb will act on fewer rows than the user picked.
  it("says nothing extra when every row supports every verb", () => {
    expect(shareSelectionCountLabel(received([CANYON]), "youSee")).toBe("1 selected");
  });

  it("tallies both subsets when both bite", () => {
    expect(
      shareSelectionCountLabel(
        received([CANYON, row("waypoint", "w1", "Car park", true)]),
        "youSee",
      ),
    ).toBe("2 selected · 1 copyable · 1 removable");
  });
});

describe("unshareAllConfirm", () => {
  it("names the count, the survival of the friendship and the lack of undo", () => {
    const confirm = unshareAllConfirm({
      count: 3,
      friendName: FRIEND,
      includesCanyon: false,
    });
    expect(confirm.title).toBe("Unshare 3 items from bob?");
    expect(confirm.body).toContain("You stay friends");
    expect(confirm.body).toContain("no undo");
    // Never claims it recalls what the friend already copied.
    expect(confirm.body).toContain("won't remove copies");
  });

  // A canyon is not one row: its notes, its photos and its linked route go with
  // it, and the user cannot see that from the list.
  it("says a canyon takes more than itself", () => {
    expect(
      unshareAllConfirm({ count: 1, friendName: FRIEND, includesCanyon: true }).body,
    ).toContain("notes");
  });

  it("reads as English for one item", () => {
    expect(
      unshareAllConfirm({ count: 1, friendName: FRIEND, includesCanyon: false }).title,
    ).toBe("Unshare 1 item from bob?");
  });
});

describe("removeAllConfirm", () => {
  // It is NOT a delete (the owner keeps theirs) and it is NOT local (it reaches
  // every device) — the two things `removeShareConfirm` exists to get right.
  it("says the owner keeps the originals, and stops there", () => {
    const confirm = removeAllConfirm({
      count: 2,
      friendName: FRIEND,
      copyableCount: 0,
    });
    expect(confirm.body).toContain("every device");
    expect(confirm.body).toContain("bob keeps the originals.");
    expect(confirm.body).not.toContain("permanently");
  });

  // "1 item are removed" shipped to the device and read as a bug in the app.
  it("agrees its verb with the count", () => {
    expect(
      removeAllConfirm({ count: 1, friendName: FRIEND, copyableCount: 0 }).body,
    ).toContain("1 item is removed");
    expect(
      removeAllConfirm({ count: 3, friendName: FRIEND, copyableCount: 0 }).body,
    ).toContain("3 items are removed");
    // ...and its noun: one item leaves one original behind, not several.
    expect(
      removeAllConfirm({ count: 1, friendName: FRIEND, copyableCount: 0 }).body,
    ).toContain("bob keeps the original.");
  });

  // "1 of them" needs a THEM: with one row selected there is nothing to be one
  // OF, and the sentence read as a counting error on the device.
  it("does not say \"1 of them\" about a single row", () => {
    const body = removeAllConfirm({
      count: 1,
      friendName: FRIEND,
      copyableCount: 1,
    }).body;
    expect(body).toContain("It's a canyon you could save a copy of first.");
    expect(body).not.toContain("of them");
  });

  // The alternative is only available BEFORE the tap, so the confirm is the last
  // place it can be offered.
  it("mentions copying first when the selection holds canyons", () => {
    expect(
      removeAllConfirm({ count: 3, friendName: FRIEND, copyableCount: 2 }).body,
    ).toContain("2 of them are canyons you could save a copy of first");
    expect(
      removeAllConfirm({ count: 3, friendName: FRIEND, copyableCount: 1 }).body,
    ).toContain("1 of them is a canyon you could save a copy of first");
  });
});

// A partial run is neither "done" nor "failed", and a user cannot retry
// "2 failed" — the names are the actionable part.
describe("outcome messages", () => {
  it("reports a clean copy run as info", () => {
    expect(copyOutcomeMessage({ copied: 2, failed: [] })).toEqual({
      text: "Saved 2 copies to your canyons.",
      tone: "info",
    });
  });

  it("names the failures in a partial copy run", () => {
    const message = copyOutcomeMessage({ copied: 1, failed: ["Claustral"] });
    expect(message.tone).toBe("error");
    expect(message.text).toBe("Saved 1 copy to your canyons. Couldn't copy Claustral.");
  });

  it("does not claim a save when nothing was copied", () => {
    expect(copyOutcomeMessage({ copied: 0, failed: ["Claustral"] })).toEqual({
      text: "Couldn't copy Claustral.",
      tone: "error",
    });
  });

  it("counts the revoke in items, singular and plural", () => {
    expect(unshareOutcomeMessage({ revokedCount: 1, friendName: FRIEND })).toBe(
      "1 item is no longer shared with bob.",
    );
    expect(unshareOutcomeMessage({ revokedCount: 4, friendName: FRIEND })).toBe(
      "4 items are no longer shared with bob.",
    );
  });

  it("reports a partial remove run with the names that stayed", () => {
    const message = removeOutcomeMessage({ removed: 2, failed: ["Car park"] });
    expect(message.tone).toBe("error");
    expect(message.text).toBe("Removed 2 items. Couldn't remove Car park.");
  });
});

// Copying is the one non-destructive verb here that still confirms: the label
// alone does not say where the copy goes or what happens to the original.
describe("copyConfirm", () => {
  it("names the single item, and says the copy outlives the share", () => {
    const confirm = copyConfirm({ count: 1, friendName: FRIEND, itemName: "Claustral" });
    expect(confirm.title).toBe("Save a copy?");
    expect(confirm.body).toContain("“Claustral”");
    expect(confirm.body).toContain("yours to edit");
    expect(confirm.body).toContain("stays if bob stops sharing");
    // Never suggests the friend's own canyon is affected.
    expect(confirm.body).toContain("bob's canyon is untouched");
  });

  it("counts in the plural without naming rows", () => {
    const confirm = copyConfirm({ count: 3, friendName: FRIEND });
    expect(confirm.title).toBe("Save 3 copies?");
    expect(confirm.body).toContain("3 canyons are copied");
    expect(confirm.body).toContain("stay if bob stops sharing");
  });
});

// A subtitle under a verb states the consequence. It used to be the confirm's
// own TITLE — a question sitting under the button that asks it.
describe("removeRowSubtitle", () => {
  it("is a statement, not a question", () => {
    const subtitle = removeRowSubtitle({ kindLabel: "canyon", friendName: FRIEND });
    expect(subtitle).toBe("Takes it off your account. bob keeps the original canyon.");
    expect(subtitle).not.toContain("?");
  });
});
