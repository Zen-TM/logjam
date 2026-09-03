// Copy for the Account sync issues screen. Pure, and separate from the screen,
// because most of what this file decides is a claim about the user's data:
// whether a change can still be saved, what discarding costs, and — in
// `previewValue` — which of an op's own field values may be drawn at all. A
// boundary with no test is a boundary that quietly stops holding.
//
// The screen's job is to answer five questions per row, in order: which of my
// things, what was I trying to do, why did it fail, can I fix it, and what
// happens if I ignore it. Everything below exists to answer one of them.
import { invalidCanyonFields, isTransientSyncError } from "@logjam/shared";

import type { ParkedOp, ShelfEntry } from "../sync/syncIssues";
import { relativeTime } from "./syncHealth";

/**
 * The kinds, in the user's words. Lower case because every string here is a
 * SENTENCE about the user's thing ("Couldn't upload …", "Your notes on a
 * canyon") rather than a label — the capitalised `Attachment`/`Canyon` labels
 * this replaces only ever appeared in the old `Canyon “X” — update` row title.
 * Media is "photo or file" because that is what the user attached; "attachment"
 * is our word for the row that carries it.
 */
const ENTITY_NOUN: Record<string, string> = {
  canyon: "canyon",
  tripLog: "trip",
  waypoint: "waypoint",
  route: "route",
  notification: "notification",
  media: "photo or file",
};

/**
 * Field names in the user's words. The shelf stores the PROTOCOL field name,
 * which is a column to us and nothing at all to the reader — "Canyon · vGrade"
 * was the whole of a row's title. Anything not listed falls back to the raw
 * name rather than being hidden: an unlabelled field is a copy gap, not a
 * reason to withhold what the user typed.
 */
const FIELD_LABEL: Record<string, string> = {
  name: "name",
  altNames: "other names",
  notes: "notes",
  numAbseils: "abseil count",
  longestAbseil: "longest abseil",
  vGrade: "water grade",
  aGrade: "difficulty grade",
  commitment: "commitment grade",
  quality: "star rating",
  hours: "trip time",
  attributes: "details",
  date: "date",
  displayName: "title",
  types: "trip type",
  customFields: "custom fields",
  canyonIds: "linked canyons",
  elevation: "elevation",
  symbol: "symbol",
  tags: "tags",
  color: "colour",
  latitude: "position",
  longitude: "position",
};

/**
 * Fields whose VALUE must never be rendered, whatever the op happens to carry.
 * A parked canyon create holds latitude/longitude, and this screen is exactly the
 * kind of page that ends up in a screenshot attached to a bug report — which is
 * the reason DESIGN.md §11 keeps coordinates off lists entirely.
 */
const UNRENDERABLE_FIELDS = new Set(["latitude", "longitude"]);

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

function entityNoun(entity: string): string {
  return ENTITY_NOUN[entity] ?? entity;
}

/** What to call the thing this op is about. Resolved when the op is loaded —
 *  an update carries no name of its own (`entityName` in syncIssues.ts). */
function opName(op: ParkedOp): string | null {
  return op.entityName && op.entityName.length > 0 ? op.entityName : null;
}

/**
 * The row's headline: what the user tried to do, as a sentence about their
 * thing rather than a log line about ours. It used to read
 * `Attachment “Davies.kml” — upload`, which is an entity, a name and a verb in
 * the order the database holds them, and says nothing about what went wrong.
 */
export function opTitle(op: ParkedOp): string {
  const name = opName(op);
  const subject = name ? `“${name}”` : `a ${entityNoun(op.entity)}`;
  if (op.entity === "media") {
    return op.op === "delete" ? `Couldn't remove ${subject}` : `Couldn't upload ${subject}`;
  }
  switch (op.op) {
    case "create":
      return name
        ? `Couldn't add ${entityNoun(op.entity)} ${subject}`
        : `Couldn't add a new ${entityNoun(op.entity)}`;
    case "update":
      return `Couldn't save your changes to ${subject}`;
    case "delete":
      return `Couldn't delete ${subject}`;
    case "markRead":
    case "markUnread":
      return "Couldn't update a notification";
    default:
      return `Couldn't sync ${subject}`;
  }
}

export type IssueAdvice = {
  /** One sentence: why it failed, in terms the reader can act on. */
  line: string;
  /** False when trying again can only park it a second time (§7 — a verb that
   *  can only refuse is ABSENT, not disabled). */
  canRetry: boolean;
  /** What to do about it, for the sheet, where there is room for a second
   *  sentence. Absent when the cause line already says it. */
  hint?: string;
};

export function opAdvice(op: ParkedOp): IssueAdvice {
  if (op.state === "deadRemote") {
    return {
      line: `This ${entityNoun(op.entity)} was deleted on another device while you were editing it.`,
      canRetry: false,
    };
  }
  const error = op.error;
  if (!error) {
    // No reason recorded. Retry is offered, because the alternative is telling
    // the user it is permanent on no evidence and inviting them to discard work.
    return { line: "This change couldn't be saved.", canRetry: true };
  }
  if (isTransientSyncError(error.code)) {
    // ONE line for every temporary failure. A dropped connection (code 0) and a
    // server that answered but refused (503) are different faults to us and the
    // same fact to the reader: it didn't get through, and it is worth another
    // go. Splitting them produced two sentences that looked like two different
    // problems on two rows of one list.
    //
    // A temporary failure only reaches this screen after the engine has spent
    // its own attempts on it (PUSH_MAX_ATTEMPTS / MEDIA_MAX_ATTEMPTS in
    // flush.ts). Saying so is what stops "Try again" reading as a chore the app
    // could have done itself — it already did, five times.
    const tried = op.attempts > 1 ? `The app tried ${op.attempts} times. ` : "";
    return {
      line: "Couldn't reach your account.",
      canRetry: true,
      hint:
        `${tried}Nothing is wrong with the change itself — try again once you're ` +
        "somewhere with better signal. It waits here until it gets through.",
    };
  }
  return {
    // The server's own message is domain copy we wrote ("Longest abseil must be
    // a number between 0 and 500"), so it is worth more than anything generic,
    // and it names the field the "What you changed" block above it is showing.
    // No hint: the rows underneath ARE the advice, and a sentence telling the
    // user to go and do what the next button does is a sentence that has not
    // earned its place.
    line: error.message || "This change can't be saved as it is.",
    canRetry: false,
  };
}

/**
 * Whether "Recreate" will actually recreate something, rather than quietly
 * discarding (`recreateFromDeadRemote` falls back to a discard for anything it
 * cannot rebuild). The row used to be offered for EVERY deadRemote op with the
 * subtitle "Saves what you typed as a new one" — which for a canyon or a trip
 * was a button that deleted the change instead.
 *
 * Waypoints only, and only with a position: a waypoint's op carries its whole
 * payload, and no other entity has a create surface this screen can reach.
 */
export function canRecreate(op: ParkedOp): boolean {
  if (op.state !== "deadRemote") return false;
  // A waypoint's op carries its whole payload, so the op alone rebuilds it.
  if (op.entity === "waypoint") {
    return typeof op.fields?.latitude === "number" && typeof op.fields?.longitude === "number";
  }
  // A canyon UPDATE carries only what it dirtied — never coordinates — so the
  // rebuild needs the phone's own copy of the row, which survives only until
  // the next delta pull applies the tombstone.
  if (op.entity === "canyon") return op.hasLocalRow;
  return false;
}

/**
 * The fields of a REJECTED edit that the server would refuse again, when we can
 * tell — the whole of "send the rest".
 *
 * We can tell because the range rules are in `shared/` and the client runs the
 * same ones (`invalidCanyonFields`). No message parsing: the server's sentence
 * is English for a person, and a client that read it would break the day
 * someone reworded it.
 *
 * Empty means "can't tell", not "nothing is wrong" — an unknown-field rejection
 * or a server-side rule looks exactly like this, and the caller must offer
 * nothing rather than re-send an edit that will park again.
 */
export function rejectedFields(op: ParkedOp): string[] {
  if (op.state !== "blocked" || op.entity !== "canyon" || !op.fields) return [];
  if (op.error && isTransientSyncError(op.error.code)) return [];
  return invalidCanyonFields(op.fields);
}

/**
 * The fields of a rejected edit that would still be accepted, and are worth
 * sending on their own. Empty when there is nothing to salvage or nothing to
 * drop — in both cases "send the rest" is not a thing to offer.
 */
export function salvageableFields(op: ParkedOp): string[] {
  const rejected = new Set(rejectedFields(op));
  if (rejected.size === 0 || !op.fields) return [];
  return Object.keys(op.fields).filter((field) => !rejected.has(field));
}

/**
 * The fields the op was carrying, for reading — "your changes" named.
 *
 * Every sentence on this screen used to be ABOUT a change without ever saying
 * what it was: "Couldn't save your changes to Butterbox Canyon" over a cause
 * and two verbs, with the actual edit — the thing the user has to decide the
 * fate of — nowhere on the page. An op holds exactly that (`fields` is the
 * dirty set for an update, the payload for a create), so it is shown.
 *
 * PRIVACY: values go through `previewValue`, which refuses coordinates; a
 * create op carries them and this screen is the one that ends up in a
 * screenshot (§11). Media's fields are bookkeeping — filename only.
 */
export type OpChange = { label: string; value: string; rejected: boolean };

export function opChanges(op: ParkedOp): OpChange[] {
  const fields = op.fields;
  if (!fields) return [];
  if (op.entity === "media") {
    const filename = fields.filename;
    return typeof filename === "string"
      ? [{ label: "File", value: filename, rejected: false }]
      : [];
  }
  // Which line the rejection is ABOUT. Without it the sheet showed two changes
  // over one complaint and left the reader to guess which had caused it.
  const rejected = new Set(rejectedFields(op));
  const changes: OpChange[] = [];
  for (const [field, value] of Object.entries(fields)) {
    // A create's own id and its link ids are plumbing, not something the user
    // typed; a coordinate renders as "(hidden)" and says nothing either.
    if (field === "id" || field.endsWith("Id") || field.endsWith("Ids")) continue;
    if (UNRENDERABLE_FIELDS.has(field)) continue;
    const label = fieldLabel(field);
    changes.push({
      // Sentence case, because this is a line of its own rather than a phrase
      // inside one ("Trip time: 6 hours", not "trip time: 6").
      label: label.charAt(0).toUpperCase() + label.slice(1),
      value: fieldValueText(field, value),
      rejected: rejected.has(field),
    });
  }
  return changes;
}

/**
 * A field's value with its unit, where the number alone is a riddle.
 *
 * "Trip time: 6" is not a fact about anything, and the rest of the app never
 * shows these bare either (the canyon screen labels them HOURS and LONGEST
 * DROP). Only the fields whose unit is not in their own name are listed — an
 * abseil count is a count.
 */
function fieldValueText(field: string, value: unknown): string {
  if (typeof value === "number") {
    if (field === "hours") return `${value} ${value === 1 ? "hour" : "hours"}`;
    if (field === "longestAbseil") return `${value} m`;
    if (field === "quality") return `${value}/5`;
  }
  return previewValue(field, value);
}

/**
 * Which entity this op is about, when the app has a screen for it — the
 * "open it and fix it" the permanent-failure hint promises. Without this the
 * hint names an action the user then has to go and find; with it the sheet
 * offers it where they are reading.
 *
 * Waypoints, routes and media are absent deliberately: none has a screen that
 * can be pushed from here, and a row that navigates nowhere is worse than none.
 */
export function opTarget(op: ParkedOp): { kind: "canyon" | "trip"; id: string } | null {
  if (op.op === "delete") return null;
  if (op.entity === "canyon") return { kind: "canyon", id: op.entityId };
  if (op.entity === "tripLog") return { kind: "trip", id: op.entityId };
  return null;
}

/**
 * What discarding actually costs, per entity — because the two are different and
 * a confirm dialog that describes the wrong one is worse than a vague one.
 *
 * Neither promises a copy anywhere any more: discarding no longer shelves what
 * was typed (see `discardParkedOp`), so this dialog is the last place the cost
 * can be stated, and the sheet behind it has just shown the user the change.
 */
export function discardExplanation(op: ParkedOp): string {
  if (op.entity === "media") {
    return "The waiting upload is deleted from this phone. The original file is untouched.";
  }
  return "What you typed is deleted from this phone. It can't be got back.";
}

/**
 * A lost value's headline. Says whose it was, which field, and which thing —
 * in the past tense, because unlike a stuck change this one has already gone.
 */
export function shelfTitle(entry: ShelfEntry): string {
  const label = fieldLabel(entry.field);
  const subject = entry.entityName
    ? `for “${entry.entityName}”`
    : `on a ${entityNoun(entry.entity)}`;
  const verb = `${isPluralLabel(label) ? "were" : "was"} ${
    entry.serverValue === null ? "cleared" : "overwritten"
  }`;
  return `Your ${label} ${subject} ${verb}`;
}

/**
 * Whether a field's label takes a plural verb — "your notes WERE overwritten",
 * "your water grade WAS". Read off the shipped row on the emulator, where every
 * singular field was claiming "were".
 *
 * Derived from the label rather than hand-listed, because a second list of
 * fields is a list that drifts from `FIELD_LABEL` (root CLAUDE.md). Every
 * plural label we write ends in "s" and no singular one does — checked in
 * `syncIssueDisplay.test.ts` across the whole map, so a future label that
 * breaks the rule (a "status", say) fails there rather than on someone's phone.
 */
function isPluralLabel(label: string): boolean {
  return label.endsWith("s");
}

/** The supporting line: what is there instead, and how long ago. */
export function shelfSubtitle(entry: ShelfEntry, now: number): string {
  const when = relativeTime(entry.at, now);
  if (entry.serverValue === null) return `Cleared on another device · ${when}`;
  return `Kept instead: ${previewValue(entry.field, entry.serverValue)} · ${when}`;
}

/**
 * Why this value is not in the user's data, in one sentence.
 *
 * The screen's hardest question — "I typed that, where did it go?" — and after
 * the merge it has exactly one answer, because a shelf entry can only ever be a
 * conflict receipt: the push was APPLIED and another device's value for that
 * field was newer. Nothing expires it, so nothing here promises a deadline.
 */
export function shelfExplanation(entry: ShelfEntry): string {
  if (entry.serverValue === null) {
    return "Another device cleared this field after you wrote it, so your text was dropped.";
  }
  return "Your change was overwritten by another device on this account.";
}

/**
 * Why a lost value can't be put back. Shown INSTEAD of the verb, never under a
 * dimmed one: both reasons mean the write would park as a fresh stuck op, and a
 * recovery action that manufactures a new sync issue is worse than none.
 */
export function restoreBlockReason(entry: ShelfEntry): string {
  switch (entry.restoreBlock) {
    case "gone":
      // Names the KIND, because the shelf row records it and "the thing this
      // belonged to" is the sentence you write when you have not looked.
      return `The ${entityNoun(entry.entity)} this belonged to has been deleted, so there's nothing to restore it into.`;
    case "unsupported":
      return "This one can't be restored automatically — make the change again yourself.";
    default:
      return "";
  }
}

/**
 * What restoring this value would do, for the row's subtitle — or null where
 * saying it would frighten someone for nothing.
 *
 * "It replaces what's there now" is the whole point of the verb when there IS
 * something there. When the other device CLEARED the field, there is nothing
 * to replace, and the warning describes a cost the user is not paying.
 */
export function restoreSubtitle(entry: ShelfEntry): string | undefined {
  return entry.serverValue === null
    ? undefined
    : "It replaces what's there now, on every device.";
}

/**
 * What restoring costs, for the confirm — it is a clobber, not a merge, and
 * after it nothing anywhere records the value it replaced.
 *
 * So the dialog QUOTES that value. This is the point of no return for it, the
 * sheet that was showing both has closed behind the dialog, and "replaces what
 * your account holds now" names no text the user can weigh. Bulk can't quote
 * (there are N of them), so it says how many instead — and Keep both is the way
 * out that costs nothing, which is why it sits next to Restore in the sheet.
 */
export function restoreConfirmBody(count: number, replacing?: string): string {
  if (count === 1) {
    const quoted = replacing ? ` It replaces “${truncate(replacing)}”, which is then gone.` : "";
    return (
      `Your value goes back into your account, on every device you're signed in on.${quoted}`
    );
  }
  return (
    `Those ${count} values go back into your account, on every device you're ` +
    "signed in on. What each one replaces is gone."
  );
}

/** Long values are quoted in a system dialog, which has no room for an essay. */
function truncate(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A shelved or parked field value, rendered for reading — never a coordinate. */
export function previewValue(field: string, value: unknown): string {
  if (UNRENDERABLE_FIELDS.has(field)) return "(hidden)";
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * The confirm body for discarding a SELECTION, as ONE function over the counts.
 *
 * Three different things wear one button here: a stuck edit (its text deleted),
 * a stuck upload (its cached copy deleted from the phone) and a lost value (the
 * last record of it, gone). A sentence true of one of them is false about the
 * other two, and counts that vary independently make copy assembled from
 * clauses read like a filled-in template — same rule, and same shape, as
 * `saved/bulkDeleteConfirm.ts`.
 */
export function bulkDiscardBody({
  editCount,
  uploadCount,
  lostCount,
}: {
  /** Stuck ops carrying text the user typed. */
  editCount: number;
  /** Stuck media ops — a cached file, deleted. */
  uploadCount: number;
  /** Lost values, deleted outright. */
  lostCount: number;
}): string {
  const clauses: string[] = [];
  if (editCount > 0) {
    clauses.push(
      editCount === 1
        ? "One change is dropped and what you typed is deleted"
        : `${editCount} changes are dropped and what you typed is deleted`,
    );
  }
  if (uploadCount > 0) {
    clauses.push(
      uploadCount === 1
        ? "One waiting upload is deleted from this phone, original untouched"
        : `${uploadCount} waiting uploads are deleted from this phone, originals untouched`,
    );
  }
  if (lostCount > 0) {
    clauses.push(
      lostCount === 1
        ? "One lost value is deleted — it is the only copy left"
        : `${lostCount} lost values are deleted — they are the only copies left`,
    );
  }
  if (clauses.length === 0) return "Nothing is selected.";
  return `${clauses.join(". ")}.`;
}

/**
 * The bulk bar's count line. It carries the TALLIES the group verbs act on, the
 * way the inbox's carries the unread count: each button in the bar acts on a
 * SUBSET of the selection, and the only honest way to show which is to say how
 * many before it is pressed.
 *
 * The line SHEDS the total when both verbs are live, and that is measured, not
 * stylistic: with two extras the bar holds five controls, and
 * "2 selected · 1 retry · 1 restore" truncated to "2 selected · 1 retry · …" on
 * a Pixel — losing the one tally the user could not otherwise work out. The
 * total is legible from the ticks; what each button will touch is not.
 */
export function selectionCountLabel({
  selected,
  retryCount,
  restoreCount,
}: {
  selected: number;
  /** Stuck ops a retry could still land. */
  retryCount: number;
  /** Lost values that can be written back. */
  restoreCount: number;
}): string {
  const verbs: string[] = [];
  if (retryCount > 0) verbs.push(`${retryCount} retry`);
  if (restoreCount > 0) verbs.push(`${restoreCount} restore`);
  if (verbs.length === 2) return verbs.join(" · ");
  return [`${selected} selected`, ...verbs].join(" · ");
}
