import { describe, expect, it } from "vitest";

import { parkedError } from "../sync/parkedError";
import type { ParkedOp, ShelfEntry } from "../sync/syncIssues";
import {
  bulkDiscardBody,
  opChanges,
  opTarget,
  hasEarlierVersion,
  keepMineConfirmBody,
  readableValue,
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
    entity: "place",
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
    entity: "place",
    entityId: "c1",
    field: "notes",
    shelvedValue: "Abseil 3 anchor spinning",
    currentValue: "Abseil 3 anchor spinning",
    changedSince: false,
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
    // A parked place create carries lat/lng. This screen is the one most likely
    // to be screenshotted into a bug report (shared/DESIGN.md §13).
    expect(previewValue("latitude", -33.7)).toBe("(hidden)");
    expect(previewValue("longitude", 150.3)).toBe("(hidden)");
  });

  it("renders the values it is allowed to", () => {
    expect(previewValue("name", "Butterbox")).toBe("Butterbox");
    expect(previewValue("hours", 6)).toBe("6");
    expect(previewValue("altNames", ["Butterbox North"])).toBe(
      '["Butterbox North"]',
    );
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
    expect(
      opTitle(parked({ entity: "tripLog", op: "delete", fields: null })),
    ).toBe("Couldn't delete a trip");
    expect(
      opTitle(
        parked({ entity: "place", op: "create", entityName: "Car park" }),
      ),
    ).toBe("Couldn't add place “Car park”");
    // A link has no name of its own, so it names what it is instead.
    expect(
      opTitle(parked({ entity: "placeLink", op: "delete", fields: null })),
    ).toBe("Couldn't delete a link between places");
  });

  it("names a media op by its filename and its own verb", () => {
    // Without filename and verb, stuck uploads would look identical under raw
    // column values.
    expect(
      opTitle(
        parked({ entity: "media", op: "create", entityName: "Davies.kml" }),
      ),
    ).toBe("Couldn't upload “Davies.kml”");
    expect(
      opTitle(parked({ entity: "media", op: "delete", fields: null })),
    ).toBe("Couldn't remove a photo or file");
  });

  it("names the thing from the MIRROR, since an update carries no name", () => {
    // The regression this exists for: three rows reading "Couldn't save your
    // changes to a place" on a list whose first job is saying WHICH place.
    // An update op's fields are only what it dirtied — notes, a grade — so the
    // name is resolved when the op is loaded and lives on `entityName`.
    expect(
      opTitle(parked({ fields: { notes: "n" }, entityName: "Claustral" })),
    ).toBe("Couldn't save your changes to “Claustral”");
    // Deleted since, or an entity with no name: say what kind it was.
    expect(opTitle(parked({ fields: { notes: "n" } }))).toBe(
      "Couldn't save your changes to a place",
    );
  });

  it("falls back rather than rendering nothing", () => {
    const title = opTitle(
      parked({
        entity: "somethingNew" as ParkedOp["entity"],
        op: "merge" as ParkedOp["op"],
      }),
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

  it("treats a validation rejection as permanent and names no hint", () => {
    // Retrying on a 400 can only park it again (shared/DESIGN.md §7 — a verb
    // that can only refuse is absent). The rows below the line are the advice,
    // so there is no hint.
    const advice = opAdvice(parked({ error: { code: 400 } }));
    expect(advice.line).toBe("This change can't be saved as it is.");
    expect(advice.canRetry).toBe(false);
    expect(advice.hint).toBeUndefined();
  });

  it("says a temporary refusal lasted a day, and blames neither the change nor the signal", () => {
    // A 503 only reaches this screen after `shouldGiveUpOnSyncOp` let it: the
    // account answered, and kept answering no, for a day. Blaming signal would
    // send the reader to look for something that was never missing.
    const refused = opAdvice(parked({ error: { code: 503 }, attempts: 40 }));
    expect(refused.line).toBe("Your account kept turning this down for a day.");
    expect(refused.canRetry).toBe(true);
    expect(refused.hint).toBe(
      "Nothing is wrong with the change itself, and Logjam GPS has stopped " +
        "trying on its own. It stays here until you try again.",
    );
    expect(refused.hint).not.toMatch(/signal|tried \d+ times/);
  });

  it("says an upload that fails on the phone is about the phone", () => {
    // Code 0 is flush.ts parking an upload that threw five times with no
    // status at all: nothing was refused and no day went by.
    const local = opAdvice(
      parked({
        entity: "media",
        op: "create",
        error: { code: 0 },
      }),
    );
    expect(local.line).toBe("This keeps failing on this phone.");
    expect(local.canRetry).toBe(true);
    expect(local.hint).toBeUndefined();
  });

  it.each([0, 401, 408, 429, 500, 503])("offers a retry on %i", (code) => {
    expect(opAdvice(parked({ error: { code } })).canRetry).toBe(true);
  });

  it.each([400, 403, 404, 409, 413, 422])("refuses a retry on %i", (code) => {
    expect(opAdvice(parked({ error: { code } })).canRetry).toBe(false);
  });

  it("does not use the server's raw words for a transient failure", () => {
    // A 500's message is our infrastructure talking, not domain copy.
    const advice = opAdvice(parked({ error: { code: 500 } }));
    expect(advice.line).not.toContain("ECONNRESET");
  });

  it("allows a retry when nothing was recorded", () => {
    // Calling it permanent on no evidence invites the user to discard work.
    expect(opAdvice(parked()).canRetry).toBe(true);
  });
});

describe("opAdvice shows a rejection in the server's sentence", () => {
  // The API writes every refusal for the user (shared/DESIGN.md §11), so the
  // phone shows it and guesses nothing. Mutation: return CANT_SAVE whatever
  // `error.sentence` holds, or pick a line from the op's fields again.
  const line = (overrides: Partial<ParkedOp>) =>
    opAdvice(parked(overrides)).line;

  it("says what the server said, whatever the op looks like", () => {
    // The rejection sentence from the server must be shown rather than guessing
    // from fields, which can produce inaccurate reasons.
    expect(
      line({
        entity: "tripLog",
        op: "create",
        fields: { date: "2026-07-01", placeIds: ["a", "a"] },
        error: {
          code: 400,
          sentence:
            "This trip lists the same place twice. Remove one and save again.",
        },
      }),
    ).toBe("This trip lists the same place twice. Remove one and save again.");
  });

  it("offers no retry for it: the same request is refused the same way", () => {
    expect(
      opAdvice(
        parked({ error: { code: 409, sentence: "That name is taken." } }),
      ).canRetry,
    ).toBe(false);
  });

  it("falls back to its own line when the server sent no sentence", () => {
    expect(line({ entity: "route", op: "update", error: { code: 400 } })).toBe(
      "This change can't be saved as it is.",
    );
  });

  it("never shows a message parked before the server wrote for the user", () => {
    // Such a row holds `{ code, message }`, the message in a developer's words
    // and sometimes with a name in it. Neither the loader nor the line reads it.
    const stored = JSON.stringify({
      code: 400,
      message: "Unknown field: Secret Gully",
    });
    expect(parkedError(stored)).toEqual({ code: 400 });
    const op = parked({
      entity: "place",
      op: "create",
      entityName: "Secret Gully",
      fields: { name: "Secret Gully", latitude: -33.7, longitude: 150.3 },
      error: { code: 400, message: "Unknown field: Secret Gully" } as never,
    });
    expect(opAdvice(op).line).toBe("This change can't be saved as it is.");
  });

  it("loads the sentence a refusal was parked with", () => {
    expect(
      parkedError(
        JSON.stringify({ code: 400, sentence: "A trip needs a date." }),
      ),
    ).toEqual({ code: 400, sentence: "A trip needs a date." });
  });
});

describe("rejectedFields / salvageableFields", () => {
  const badGrade = parked({
    fields: { notes: "rebolted", fieldValues: { v_grade: 9 } },
    error: { code: 400 },
  });

  it("splits a rejected edit into what the server refused and what it didn't", () => {
    // Without salvaging valid fields, one bad number takes valid notes down
    // with it because the API validates the whole payload and parks the op.
    // The whole `fieldValues` blob is ONE dirty field on the wire, so that is
    // the granularity a "send the rest" offer can work at — the client cannot
    // resend half a JSON column.
    expect(rejectedFields(badGrade)).toEqual(["fieldValues"]);
    expect(salvageableFields(badGrade)).toEqual(["notes"]);
  });

  it("offers nothing when a retry is what's called for", () => {
    // A transient failure is the engine's problem, and re-sending a SUBSET of
    // it would silently drop fields over a dropped connection.
    const transient = parked({
      fields: { notes: "x", fieldValues: { v_grade: 9 } },
      error: { code: 503 },
    });
    expect(rejectedFields(transient)).toEqual([]);
    expect(salvageableFields(transient)).toEqual([]);
  });

  it("offers nothing when every dirty field was refused", () => {
    // Nothing to salvage — the sheet falls back to Discard, which is honest.
    const allBad = parked({
      fields: { fieldValues: { v_grade: 9 } },
      error: { code: 400 },
    });
    expect(rejectedFields(allBad)).toEqual(["fieldValues"]);
    expect(salvageableFields(allBad)).toEqual([]);
  });

  it("offers nothing for a rejection it cannot attribute", () => {
    const unknown = parked({
      fields: { notes: "x" },
      error: { code: 400 },
    });
    expect(salvageableFields(unknown)).toEqual([]);
  });

  it("offers nothing for an entity whose rules aren't shared", () => {
    // Only places have their range rules in `shared/`. Guessing for a trip
    // would mean parsing the server's English.
    expect(
      rejectedFields(
        parked({
          entity: "tripLog",
          fields: { hours: -1 },
          error: { code: 400 },
        }),
      ),
    ).toEqual([]);
  });
});

describe("restoreSubtitle", () => {
  it("says restoring replaces the user's own text", () => {
    expect(restoreSubtitle()).toMatch(/Replaces yours/);
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
    // screenshot (shared/DESIGN.md §13). Hidden entirely rather than "(hidden)": a row
    // reading "position: (hidden)" is noise, not caution.
    const changes = opChanges(
      parked({
        op: "create",
        fields: { name: "New place", latitude: -33.7, longitude: 150.3 },
      }),
    );
    expect(changes).toEqual([
      { label: "Name", value: "New place", rejected: false },
    ]);
  });

  it("drops plumbing the user never typed", () => {
    const changes = opChanges(
      parked({ fields: { id: "x", placeIds: ["a"], notes: "n" } }),
    );
    expect(changes).toEqual([{ label: "Notes", value: "n", rejected: false }]);
  });

  it("marks WHICH line the rejection is about", () => {
    // Without marking which line was rejected, multiple changes leave the
    // reader guessing. The client runs the same range rules as the API
    // (`shared/`), so it can point at the field without reading the server's
    // English.
    const changes = opChanges(
      parked({
        fields: { notes: "rebolted", fieldValues: { v_grade: 9 } },
        error: { code: 400 },
      }),
    );
    // `fieldValues` is one field on the wire but is expanded into a line per
    // value, so the reader still sees WHICH value the complaint is about.
    expect(changes.map((change) => [change.label, change.rejected])).toEqual([
      ["Notes", false],
      ["Water grade", true],
    ]);
  });

  it("marks nothing when the rejection is one we can't attribute", () => {
    // An unknown-field rejection or a server-side rule looks like a valid
    // payload from here, and guessing would point at an innocent line.
    const changes = opChanges(
      parked({
        fields: { notes: "x" },
        error: { code: 400 },
      }),
    );
    expect(changes.every((change) => !change.rejected)).toBe(true);
  });

  it("carries the unit where the bare number would be a riddle", () => {
    expect(opChanges(parked({ fields: { hours: 1 } }))[0].value).toBe("1 hour");
    expect(opChanges(parked({ fields: { longestAbseil: 35 } }))[0].value).toBe(
      "35 m",
    );
    expect(opChanges(parked({ fields: { quality: 4 } }))[0].value).toBe("4/5");
    // A count is a count.
    expect(opChanges(parked({ fields: { numAbseils: 5 } }))[0].value).toBe("5");
  });

  it("shows a media op's filename and nothing else", () => {
    const changes = opChanges(
      parked({
        entity: "media",
        op: "create",
        fields: { filename: "IMG_1.jpg", linkedId: "c1" },
      }),
    );
    expect(changes).toEqual([
      { label: "File", value: "IMG_1.jpg", rejected: false },
    ]);
  });
});

describe("opTarget", () => {
  it("offers the entity for the kinds that have a screen", () => {
    expect(opTarget(parked({ entity: "place", entityId: "c1" }))).toEqual({
      kind: "place",
      id: "c1",
    });
    expect(opTarget(parked({ entity: "tripLog", entityId: "t1" }))).toEqual({
      kind: "trip",
      id: "t1",
    });
  });

  it("offers nothing where a tap would go nowhere", () => {
    // No screen to push, or — for a delete — nothing left to open.
    expect(opTarget(parked({ entity: "placeLink" }))).toBeNull();
    expect(opTarget(parked({ entity: "media" }))).toBeNull();
    expect(opTarget(parked({ entity: "place", op: "delete" }))).toBeNull();
  });
});

describe("discardExplanation", () => {
  it("promises no copy anywhere, because discarding no longer keeps one", () => {
    // Discarding drops what was typed rather than shelving it to avoid asking
    // the user to decide the same thing twice. This dialog is now the last place
    // the cost can be stated.
    const text = discardExplanation(parked({ entity: "place" }));
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
    // A place update carries no coordinates, so the rebuild comes from the
    // phone's own mirror row — which lasts only until the delta pull applies
    // the tombstone.
    const place = parked({
      entity: "place",
      state: "deadRemote",
      fields: { notes: "x" },
    });
    expect(canRecreate(place)).toBe(true);
    expect(canRecreate({ ...place, hasLocalRow: false })).toBe(false);
  });

  it("is false where that call would quietly discard instead", () => {
    // For anything other than a place with a local row, recreation would fall
    // back to a discard — a button that deletes the change it promises
    // to keep.
    expect(
      canRecreate(
        parked({
          entity: "tripLog",
          state: "deadRemote",
          fields: { notes: "x" },
        }),
      ),
    ).toBe(false);
    // A LINK carries no payload of its own and its endpoints may be gone, so
    // there is nothing to rebuild from at all.
    expect(
      canRecreate(
        parked({ entity: "placeLink", state: "deadRemote", fields: null }),
      ),
    ).toBe(false);
    // Only a DEAD remote op can be recreated; a blocked one still has a server
    // row waiting for it.
    expect(canRecreate(parked({ entity: "place", state: "blocked" }))).toBe(
      false,
    );
  });
});

describe("shelf copy", () => {
  it("names the field and the thing, and does not say whose text won", () => {
    expect(shelfTitle(shelved())).toBe(
      "Notes for “Claustral” changed on two devices",
    );
    expect(shelfTitle(shelved({ field: "v_grade" }))).toBe(
      "Water grade for “Claustral” changed on two devices",
    );
    // The name is captured when the value is shelved, so it survives the row
    // being deleted — this fallback is for entries shelved before that column.
    expect(shelfTitle(shelved({ entityName: null }))).toBe(
      "Notes on a place changed on two devices",
    );
  });

  // Mutation: swap the two values back (describe `serverValue` as the winner).
  it("says the user's version was saved, and shows what it replaced", () => {
    expect(shelfSubtitle(shelved(), NOW)).toBe(
      "Replaced: Classic. Do it in summer. · yesterday",
    );
    expect(shelfExplanation(shelved())).toBe(
      "Your version was saved. It replaced a different one that another device wrote.",
    );
    expect(shelfExplanation(shelved())).not.toMatch(/overwritten|dropped|lost/);
  });

  it("says nothing was replaced when the account had nothing there", () => {
    expect(shelfSubtitle(shelved({ serverValue: null }), NOW)).toBe(
      "Yours was saved · yesterday",
    );
    expect(shelfExplanation(shelved({ serverValue: null }))).toMatch(
      /Your version was saved/,
    );
  });

  it("says what happened to the thing, for every reason a restore is refused", () => {
    // Two reasons, not four: a shelf entry only exists for a row the push was
    // APPLIED to (one the user owns), and a restored row is deleted on restore.
    // It names the kind from the recorded entity rather than generic phrasing.
    expect(restoreBlockReason(shelved({ restoreBlock: "gone" }))).toBe(
      "The place this belonged to has been deleted, so there's nothing to restore it into.",
    );
    expect(
      restoreBlockReason(shelved({ entity: "tripLog", restoreBlock: "gone" })),
    ).toMatch(/^The trip this belonged to/);
    expect(
      restoreBlockReason(shelved({ restoreBlock: "unsupported" })),
    ).toMatch(/yourself/);
    expect(restoreBlockReason(shelved({ restoreBlock: "nothing" }))).toMatch(
      /nothing there before/,
    );
  });
});

describe("bulkDiscardBody", () => {
  it("counts each consequence separately, because they are different deletes", () => {
    const body = bulkDiscardBody({
      editCount: 2,
      uploadCount: 1,
      lostCount: 3,
    });
    expect(body).toContain("2 changes are dropped");
    expect(body).toContain("One waiting upload is deleted from this phone");
    expect(body).toContain("3 earlier versions are deleted");
  });

  it("never mentions a kind the selection does not contain", () => {
    const body = bulkDiscardBody({
      editCount: 1,
      uploadCount: 0,
      lostCount: 0,
    });
    expect(body).toBe("One change is dropped and what you typed is deleted.");
  });

  it("says the lost half is the last copy", () => {
    expect(
      bulkDiscardBody({ editCount: 0, uploadCount: 0, lostCount: 1 }),
    ).toContain("only copy left");
  });
});

describe("restoreConfirmBody", () => {
  it("QUOTES the user's own text it is about to replace", () => {
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
    expect(restoreConfirmBody(4)).toMatch(/Those 4 earlier versions/);
  });
});

describe("selectionCountLabel", () => {
  it("carries a tally per group verb, because each acts on a subset", () => {
    expect(
      selectionCountLabel({ selected: 5, retryCount: 3, restoreCount: 0 }),
    ).toBe("5 selected · 3 retry");
    expect(
      selectionCountLabel({ selected: 4, retryCount: 0, restoreCount: 3 }),
    ).toBe("4 selected · 3 restore");
  });

  it("sheds the total when both verbs are live, because the bar has no room", () => {
    // Measured on a Pixel: five controls in the bar truncated
    // "5 selected · 2 retry · 3 restore" to "5 selected · 2 retry · …", losing
    // the one tally the ticks can't tell you.
    expect(
      selectionCountLabel({ selected: 5, retryCount: 2, restoreCount: 3 }),
    ).toBe("2 retry · 3 restore");
  });

  it("names no verb when nothing picked can take one", () => {
    expect(
      selectionCountLabel({ selected: 2, retryCount: 0, restoreCount: 0 }),
    ).toBe("2 selected");
  });
});

describe("keepMineConfirmBody", () => {
  it("quotes the earlier text, because deleting it is the whole cost", () => {
    const body = keepMineConfirmBody("Classic. Do it in summer.");
    expect(body).toContain("“Classic. Do it in summer.”");
    expect(body).toMatch(/Your version stays/);
  });
});

describe("hasEarlierVersion", () => {
  // Mutation: test `typeof serverValue === "string"` instead — an attributes
  // blob, a list or a number would then be deleted by Keep my version with no
  // dialog.
  it("is true for a value of any type, false only for nothing", () => {
    expect(hasEarlierVersion(shelved())).toBe(true);
    expect(
      hasEarlierVersion(
        shelved({ field: "fieldValues", serverValue: { quality: 3 } }),
      ),
    ).toBe(true);
    expect(
      hasEarlierVersion(shelved({ field: "altNames", serverValue: ["a"] })),
    ).toBe(true);
    expect(
      hasEarlierVersion(shelved({ field: "elevation", serverValue: 0 })),
    ).toBe(true);
    expect(hasEarlierVersion(shelved({ serverValue: null }))).toBe(false);
  });
});

describe("readableValue", () => {
  it("reads lists, attributes and numbers as words, not JSON", () => {
    expect(readableValue("altNames", ["Upper", "Lower"])).toBe("Upper, Lower");
    expect(
      readableValue("fieldValues", { quality: 3, _internal: 1, hours: 6 }),
    ).toBe("Star rating: 3/5; Trip time: 6 hours");
    expect(readableValue("elevation", 120)).toBe("120");
    expect(readableValue("latitude", -33.6)).toBe("(hidden)");
  });
});

describe("a conflict whose field changed after the push", () => {
  it("says so instead of claiming the user's version is what's saved", () => {
    expect(shelfExplanation(shelved({ changedSince: true }))).toMatch(
      /changed again/,
    );
  });
});
