import { describe, expect, it } from "vitest";

import type { ParkedOp, ShelfEntry } from "../sync/syncIssues";
import {
  bulkDiscardBody,
  opChanges,
  opTarget,
  restoreConfirmBody,
  canRecreate,
  rejectedFields,
  restoreSubtitle,
  salvageableFields,
  shelfExplanation,
  discardExplanation,
  opAdvice,
  opTitle,
  previewValue,
  restoreBlockReason,
  selectionCountLabel,
  shelfSubtitle,
  shelfTitle,
} from "./syncIssueDisplay";

function parked(overrides: Partial<ParkedOp> = {}): ParkedOp {
  return {
    seq: 1,
    entity: "canyon",
    op: "update",
    entityId: "c1",
    state: "blocked",
    fields: null,
    error: null,
    attempts: 1,
    createdAt: "2026-07-30T00:00:00.000Z",
    entityName: null,
    hasLocalRow: true,
    ...overrides,
  };
}

function shelved(overrides: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    id: 1,
    entity: "canyon",
    entityId: "c1",
    field: "notes",
    shelvedValue: "Abseil 3 anchor spinning",
    serverValue: "Classic. Do it in summer.",
    at: "2026-08-30T00:00:00.000Z",
    restoreBlock: null,
    canKeepBoth: true,
    entityName: "Claustral",
    ...overrides,
  };
}

const NOW = Date.parse("2026-08-31T00:00:00.000Z");

describe("previewValue", () => {
  it("never renders a coordinate", () => {
    // A parked canyon create carries lat/lng. This screen is the one most likely
    // to be screenshotted into a bug report (DESIGN.md §11).
    expect(previewValue("latitude", -33.7)).toBe("(hidden)");
    expect(previewValue("longitude", 150.3)).toBe("(hidden)");
  });

  it("renders the values it is allowed to", () => {
    expect(previewValue("name", "Butterbox")).toBe("Butterbox");
    expect(previewValue("hours", 6)).toBe("6");
    expect(previewValue("altNames", ["Butterbox North"])).toBe('["Butterbox North"]');
  });

  it("distinguishes empty from absent-looking values", () => {
    expect(previewValue("notes", null)).toBe("(empty)");
    expect(previewValue("notes", undefined)).toBe("(empty)");
    expect(previewValue("notes", "")).toBe("");
  });
});

describe("opTitle", () => {
  it("says what the user tried to do, not what the table holds", () => {
    expect(opTitle(parked({ entityName: "Claustral" }))).toBe(
      "Couldn't save your changes to “Claustral”",
    );
    expect(opTitle(parked({ entity: "tripLog", op: "delete", fields: null }))).toBe(
      "Couldn't delete a trip",
    );
    expect(
      opTitle(parked({ entity: "waypoint", op: "create", entityName: "Car" })),
    ).toBe("Couldn't add waypoint “Car”");
  });

  it("names a media op by its filename and its own verb", () => {
    // "media — create" was the raw column values reaching the screen, and every
    // stuck upload looked like every other one.
    expect(
      opTitle(parked({ entity: "media", op: "create", entityName: "Davies.kml" })),
    ).toBe("Couldn't upload “Davies.kml”");
    expect(opTitle(parked({ entity: "media", op: "delete", fields: null }))).toBe(
      "Couldn't remove a photo or file",
    );
  });

  it("names the thing from the MIRROR, since an update carries no name", () => {
    // The regression this exists for: three rows reading "Couldn't save your
    // changes to a canyon" on a list whose first job is saying WHICH canyon.
    // An update op's fields are only what it dirtied — notes, a grade — so the
    // name is resolved when the op is loaded and lives on `entityName`.
    expect(opTitle(parked({ fields: { notes: "n" }, entityName: "Claustral" }))).toBe(
      "Couldn't save your changes to “Claustral”",
    );
    // Deleted since, or an entity with no name: say what kind it was.
    expect(opTitle(parked({ fields: { notes: "n" } }))).toBe(
      "Couldn't save your changes to a canyon",
    );
  });

  it("falls back rather than rendering nothing", () => {
    const title = opTitle(
      parked({ entity: "somethingNew" as ParkedOp["entity"], op: "merge" as ParkedOp["op"] }),
    );
    expect(title).toBe("Couldn't sync a somethingNew");
  });
});

describe("opAdvice", () => {
  it("explains a lost edit↔delete race, and never offers a retry for it", () => {
    const advice = opAdvice(parked({ state: "deadRemote" }));
    expect(advice.line).toMatch(/deleted on another device/);
    expect(advice.canRetry).toBe(false);
  });

  it("treats a validation rejection as permanent and shows the server's words", () => {
    // Retry on a 400 can only park it a second time, which is what taught users
    // the button does nothing (§7 — a verb that can only refuse is absent). The
    // server's own message names the field the sheet is already showing, and
    // there is NO hint: the rows below it are the advice, and a sentence
    // telling the user to go and do what the next button does is prose that has
    // not earned its place.
    const advice = opAdvice(
      parked({
        error: { code: 400, message: "Longest abseil must be a number between 0 and 500" },
      }),
    );
    expect(advice.line).toBe("Longest abseil must be a number between 0 and 500");
    expect(advice.canRetry).toBe(false);
    expect(advice.hint).toBeUndefined();
  });

  it("gives ONE line for every temporary failure, whatever its code", () => {
    // A dropped connection (code 0) and a server that refused (503) are two
    // faults to us and one fact to the reader: it didn't get through. Two
    // sentences read as two different problems on two rows of one list.
    const dropped = opAdvice(parked({ error: { code: 0, message: "upload failed" }, attempts: 5 }));
    const refused = opAdvice(parked({ error: { code: 503, message: "upstream" }, attempts: 5 }));
    expect(dropped.line).toBe("Couldn't reach your account.");
    expect(refused.line).toBe(dropped.line);
    // And it says what the app already spent, so Try again doesn't read as a
    // chore the app could have done itself.
    expect(dropped.hint).toMatch(/tried 5 times/);
    expect(dropped.hint).toMatch(/waits here until it gets through/);
  });

  it.each([0, 401, 408, 429, 500, 503])("offers a retry on %i", (code) => {
    expect(opAdvice(parked({ error: { code, message: "boom" } })).canRetry).toBe(true);
  });

  it.each([400, 403, 404, 409, 413, 422])("refuses a retry on %i", (code) => {
    expect(opAdvice(parked({ error: { code, message: "boom" } })).canRetry).toBe(false);
  });

  it("does not use the server's raw words for a transient failure", () => {
    // A 500's message is our infrastructure talking, not domain copy.
    const advice = opAdvice(parked({ error: { code: 500, message: "ECONNRESET" } }));
    expect(advice.line).not.toContain("ECONNRESET");
  });

  it("says how many attempts the app already spent, so Retry isn't a chore", () => {
    // The engine retries transient rejections itself (flush.ts), so anything
    // temporary that reaches this screen has already been tried five times —
    // and the copy has to say so, or the button reads as work the app skipped.
    const advice = opAdvice(parked({ error: { code: 503, message: "x" }, attempts: 5 }));
    expect(advice.hint).toMatch(/tried 5 times/);
    // A first-attempt failure (a media op parked by its own runner) says no
    // such thing rather than claiming one attempt was five.
    expect(opAdvice(parked({ error: { code: 0, message: "x" }, attempts: 1 })).hint).not.toMatch(
      /tried/,
    );
  });

  it("allows a retry when nothing was recorded", () => {
    // Calling it permanent on no evidence invites the user to discard work.
    expect(opAdvice(parked()).canRetry).toBe(true);
  });
});

describe("rejectedFields / salvageableFields", () => {
  const badGrade = parked({
    fields: { notes: "rebolted", vGrade: 9 },
    error: { code: 400, message: "V grade must be between 1 and 7" },
  });

  it("splits a rejected edit into what the server refused and what it didn't", () => {
    // One bad number used to take a paragraph of notes down with it: the API
    // validates the whole payload, so the whole op parks.
    expect(rejectedFields(badGrade)).toEqual(["vGrade"]);
    expect(salvageableFields(badGrade)).toEqual(["notes"]);
  });

  it("offers nothing when a retry is what's called for", () => {
    // A transient failure is the engine's problem, and re-sending a SUBSET of
    // it would silently drop fields over a dropped connection.
    const transient = parked({
      fields: { notes: "x", vGrade: 9 },
      error: { code: 503, message: "upstream" },
    });
    expect(rejectedFields(transient)).toEqual([]);
    expect(salvageableFields(transient)).toEqual([]);
  });

  it("offers nothing when every dirty field was refused", () => {
    // Nothing to salvage — the sheet falls back to Discard, which is honest.
    const allBad = parked({
      fields: { vGrade: 9 },
      error: { code: 400, message: "V grade must be between 1 and 7" },
    });
    expect(rejectedFields(allBad)).toEqual(["vGrade"]);
    expect(salvageableFields(allBad)).toEqual([]);
  });

  it("offers nothing for a rejection it cannot attribute", () => {
    const unknown = parked({
      fields: { notes: "x" },
      error: { code: 400, message: "Unknown field: q" },
    });
    expect(salvageableFields(unknown)).toEqual([]);
  });

  it("offers nothing for an entity whose rules aren't shared", () => {
    // Only canyons have their range rules in `shared/`. Guessing for a trip
    // would mean parsing the server's English.
    expect(
      rejectedFields(
        parked({ entity: "tripLog", fields: { hours: -1 }, error: { code: 400, message: "x" } }),
      ),
    ).toEqual([]);
  });
});

describe("restoreSubtitle", () => {
  it("warns about the replacement only when there IS something to replace", () => {
    expect(restoreSubtitle(shelved())).toMatch(/replaces what's there now/);
    // The other device CLEARED the field: nothing is being overwritten, and the
    // warning would describe a cost the user is not paying.
    expect(restoreSubtitle(shelved({ serverValue: null }))).toBeUndefined();
  });
});

describe("opChanges", () => {
  it("names what the user actually changed, so they aren't judging it unseen", () => {
    const changes = opChanges(
      parked({ fields: { notes: "Anchor rebuilt", hours: 6 } }),
    );
    expect(changes).toEqual([
      { label: "Notes", value: "Anchor rebuilt", rejected: false },
      // With its unit: "Trip time: 6" is not a fact about anything.
      { label: "Trip time", value: "6 hours", rejected: false },
    ]);
  });

  it("never renders a coordinate, whatever the op carries", () => {
    // A create carries lat/lng, and this screen is the one that ends up in a
    // screenshot (DESIGN.md §11). Hidden entirely rather than "(hidden)": a row
    // reading "position: (hidden)" is noise, not caution.
    const changes = opChanges(
      parked({ op: "create", fields: { name: "New canyon", latitude: -33.7, longitude: 150.3 } }),
    );
    expect(changes).toEqual([{ label: "Name", value: "New canyon", rejected: false }]);
  });

  it("drops plumbing the user never typed", () => {
    const changes = opChanges(parked({ fields: { id: "x", canyonIds: ["a"], notes: "n" } }));
    expect(changes).toEqual([{ label: "Notes", value: "n", rejected: false }]);
  });

  it("marks WHICH line the rejection is about", () => {
    // Two changes over one complaint left the reader guessing which had caused
    // it. The client runs the same range rules as the API (`shared/`), so it
    // can point at the field without reading the server's English.
    const changes = opChanges(
      parked({
        fields: { notes: "rebolted", vGrade: 9 },
        error: { code: 400, message: "V grade must be between 1 and 7" },
      }),
    );
    expect(changes.map((change) => [change.label, change.rejected])).toEqual([
      ["Notes", false],
      ["Water grade", true],
    ]);
  });

  it("marks nothing when the rejection is one we can't attribute", () => {
    // An unknown-field rejection or a server-side rule looks like a valid
    // payload from here, and guessing would point at an innocent line.
    const changes = opChanges(
      parked({ fields: { notes: "x" }, error: { code: 400, message: "Unknown field: q" } }),
    );
    expect(changes.every((change) => !change.rejected)).toBe(true);
  });

  it("carries the unit where the bare number would be a riddle", () => {
    expect(opChanges(parked({ fields: { hours: 1 } }))[0].value).toBe("1 hour");
    expect(opChanges(parked({ fields: { longestAbseil: 35 } }))[0].value).toBe("35 m");
    expect(opChanges(parked({ fields: { quality: 4 } }))[0].value).toBe("4/5");
    // A count is a count.
    expect(opChanges(parked({ fields: { numAbseils: 5 } }))[0].value).toBe("5");
  });

  it("shows a media op's filename and nothing else", () => {
    const changes = opChanges(
      parked({ entity: "media", op: "create", fields: { filename: "IMG_1.jpg", linkedId: "c1" } }),
    );
    expect(changes).toEqual([{ label: "File", value: "IMG_1.jpg", rejected: false }]);
  });
});

describe("opTarget", () => {
  it("offers the entity for the kinds that have a screen", () => {
    expect(opTarget(parked({ entity: "canyon", entityId: "c1" }))).toEqual({
      kind: "canyon",
      id: "c1",
    });
    expect(opTarget(parked({ entity: "tripLog", entityId: "t1" }))).toEqual({
      kind: "trip",
      id: "t1",
    });
  });

  it("offers nothing where a tap would go nowhere", () => {
    // No screen to push, or — for a delete — nothing left to open.
    expect(opTarget(parked({ entity: "waypoint" }))).toBeNull();
    expect(opTarget(parked({ entity: "media" }))).toBeNull();
    expect(opTarget(parked({ entity: "canyon", op: "delete" }))).toBeNull();
  });
});

describe("discardExplanation", () => {
  it("promises no copy anywhere, because discarding no longer keeps one", () => {
    // It used to shelve what was typed, and the row it left behind asked the
    // user to decide the same thing twice. This dialog is now the last place
    // the cost can be stated.
    const text = discardExplanation(parked({ entity: "canyon" }));
    expect(text).not.toMatch(/Lost/);
    expect(text).toMatch(/can't be got back/);
  });

  it("describes the deleted local copy for media, and spares the original", () => {
    const text = discardExplanation(parked({ entity: "media" }));
    expect(text).toMatch(/deleted from this phone/);
    expect(text).toMatch(/original file is untouched/);
  });
});

describe("canRecreate", () => {
  it("is true only where recreateFromDeadRemote will really recreate", () => {
    const waypoint = parked({
      entity: "waypoint",
      state: "deadRemote",
      fields: { name: "Anchor", latitude: -33.5, longitude: 150.4 },
    });
    expect(canRecreate(waypoint)).toBe(true);
    // A canyon update carries no coordinates, so the rebuild comes from the
    // phone's own mirror row — which lasts only until the delta pull applies
    // the tombstone.
    const canyon = parked({ entity: "canyon", state: "deadRemote", fields: { notes: "x" } });
    expect(canRecreate(canyon)).toBe(true);
    expect(canRecreate({ ...canyon, hasLocalRow: false })).toBe(false);
  });

  it("is false where that call would quietly discard instead", () => {
    // The button said "Saves what you typed as a new one" for every deadRemote
    // op, and for anything but a positioned waypoint the implementation falls
    // back to a discard — a button that deletes the change it promises to keep.
    expect(
      canRecreate(
        parked({ entity: "tripLog", state: "deadRemote", fields: { notes: "x" } }),
      ),
    ).toBe(false);
    // A rename-only waypoint edit carries no coordinates, and a waypoint with
    // no position is not a waypoint.
    expect(
      canRecreate(parked({ entity: "waypoint", state: "deadRemote", fields: { name: "x" } })),
    ).toBe(false);
    expect(canRecreate(parked({ entity: "waypoint", state: "blocked" }))).toBe(false);
  });
});

describe("shelf copy", () => {
  it("names the field and the thing, in the past tense", () => {
    expect(shelfTitle(shelved())).toBe("Your notes for “Claustral” were overwritten");
    // Agreement follows the FIELD, and got this wrong on a shipped row: "your
    // water grade WERE overwritten".
    expect(shelfTitle(shelved({ field: "vGrade" }))).toBe(
      "Your water grade for “Claustral” was overwritten",
    );
    // The name is captured when the value is shelved, so it survives the row
    // being deleted — this fallback is for entries shelved before that column.
    expect(shelfTitle(shelved({ entityName: null }))).toBe(
      "Your notes on a canyon were overwritten",
    );
  });

  it("agrees in number with every field label we ship", () => {
    // The rule is "a plural label ends in s, a singular one doesn't", which is
    // true of the whole map today and is what `isPluralLabel` reads. A future
    // label that breaks it (a "status") fails here rather than on a phone.
    const plural = ["notes", "altNames", "tags", "canyonIds", "attributes",
      "customFields"];
    // `types` is in here on purpose: the FIELD is plural and its LABEL — "trip
    // type" — is not, and the label is what the sentence has to agree with.
    const singular = ["name", "types", "vGrade", "aGrade", "commitment", "quality",
      "hours", "date", "displayName", "elevation", "symbol", "color", "numAbseils",
      "longestAbseil"];
    for (const field of plural) {
      expect(shelfTitle(shelved({ field })), field).toContain(" were ");
    }
    for (const field of singular) {
      expect(shelfTitle(shelved({ field })), field).toContain(" was ");
    }
  });

  it("says CLEARED when the other device emptied the field", () => {
    // A null server value is a real outcome, not a missing one, and "overwritten"
    // would leave the user hunting for a replacement that does not exist.
    expect(shelfTitle(shelved({ serverValue: null }))).toMatch(/were cleared$/);
    expect(shelfSubtitle(shelved({ serverValue: null }), NOW)).toBe(
      "Cleared on another device · yesterday",
    );
    expect(shelfExplanation(shelved({ serverValue: null }))).toMatch(/cleared this field/);
  });

  it("shows what is there instead in the supporting line", () => {
    expect(shelfSubtitle(shelved(), NOW)).toBe(
      "Kept instead: Classic. Do it in summer. · yesterday",
    );
  });

  it("answers 'I typed that, where did it go' in one sentence", () => {
    // One answer, because a shelf entry can only ever be a conflict receipt:
    // the push was applied and a newer value for that field won. No deadline —
    // nothing expires these any more.
    const text = shelfExplanation(shelved());
    expect(text).toBe("Your change was overwritten by another device on this account.");
    expect(text).not.toMatch(/30 days/);
  });

  it("says what happened to the thing, for every reason a restore is refused", () => {
    // Two reasons, not four: `readOnly` was unreachable (a shelf entry only
    // exists for a row the push was APPLIED to, i.e. one the user owns) and
    // `restored` went with the row, which is now deleted on restore.
    // And it NAMES the kind: the shelf row records the entity, so "the thing
    // this belonged to" was a sentence written without looking.
    expect(restoreBlockReason(shelved({ restoreBlock: "gone" }))).toBe(
      "The canyon this belonged to has been deleted, so there's nothing to restore it into.",
    );
    expect(restoreBlockReason(shelved({ entity: "tripLog", restoreBlock: "gone" }))).toMatch(
      /^The trip this belonged to/,
    );
    expect(restoreBlockReason(shelved({ restoreBlock: "unsupported" }))).toMatch(/yourself/);
  });
});

describe("bulkDiscardBody", () => {
  it("counts each consequence separately, because they are different deletes", () => {
    const body = bulkDiscardBody({ editCount: 2, uploadCount: 1, lostCount: 3 });
    expect(body).toContain("2 changes are dropped");
    expect(body).toContain("One waiting upload is deleted from this phone");
    expect(body).toContain("3 lost values are deleted");
  });

  it("never mentions a kind the selection does not contain", () => {
    const body = bulkDiscardBody({ editCount: 1, uploadCount: 0, lostCount: 0 });
    expect(body).toBe("One change is dropped and what you typed is deleted.");
  });

  it("says the lost half is the last copy", () => {
    expect(bulkDiscardBody({ editCount: 0, uploadCount: 0, lostCount: 1 })).toContain(
      "only copy left",
    );
  });
});

describe("restoreConfirmBody", () => {
  it("QUOTES the value it is about to destroy", () => {
    // This is the last moment that text exists anywhere, and the sheet showing
    // it has closed behind the dialog — "replaces what your account holds now"
    // names nothing the user can weigh.
    const body = restoreConfirmBody(1, "Classic. Do it in summer.");
    expect(body).toContain("“Classic. Do it in summer.”");
    expect(body).toMatch(/on every device/);
    expect(body).not.toMatch(/below/);
    // Nothing survives it any more: the shelf row goes when the restore lands.
    expect(body).not.toMatch(/kept here/);
  });

  it("omits the quote when there is no value to quote", () => {
    expect(restoreConfirmBody(1)).not.toContain("“");
  });

  it("counts instead of quoting in bulk, where N values cannot all be shown", () => {
    expect(restoreConfirmBody(4)).toMatch(/Those 4 values/);
  });
});

describe("selectionCountLabel", () => {
  it("carries a tally per group verb, because each acts on a subset", () => {
    expect(selectionCountLabel({ selected: 5, retryCount: 3, restoreCount: 0 })).toBe(
      "5 selected · 3 retry",
    );
    expect(selectionCountLabel({ selected: 4, retryCount: 0, restoreCount: 3 })).toBe(
      "4 selected · 3 restore",
    );
  });

  it("sheds the total when both verbs are live, because the bar has no room", () => {
    // Measured on a Pixel: five controls in the bar truncated
    // "5 selected · 2 retry · 3 restore" to "5 selected · 2 retry · …", losing
    // the one tally the ticks can't tell you.
    expect(selectionCountLabel({ selected: 5, retryCount: 2, restoreCount: 3 })).toBe(
      "2 retry · 3 restore",
    );
  });

  it("names no verb when nothing picked can take one", () => {
    expect(selectionCountLabel({ selected: 2, retryCount: 0, restoreCount: 0 })).toBe(
      "2 selected",
    );
  });
});
