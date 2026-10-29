/**
 * Local persistence for a half-written trip log.
 *
 * This is the counterpart to `useUnsavedChangesGuard`, not a replacement. The
 * guard covers *deliberate* exits — Cancel, Esc, the X — where the user is
 * present to answer a prompt. This covers the exits no prompt can catch: the OS
 * evicting the tab, a phone call, a flat battery. Between them, "I typed it and
 * it's gone" has no path left.
 *
 * Deliberately narrow, because the payload is the sensitive one (place names
 * and notes) sitting in a store that any script on the origin can read and that
 * outlives the session:
 *
 * - **Create only.** `mode` is written into the record and re-checked on read,
 *   so a create draft can never repopulate an *edit* of an unrelated trip —
 *   that would silently overwrite a saved trip with text from another one.
 * - **One slot.** Cleared on save and on discard.
 * - **Expires.** A draft older than TRIP_DRAFT_MAX_AGE_MS is dropped on read
 *   rather than offered: the restore prompt asks the user to recognise work
 *   they abandoned, and past a week they won't.
 * - **Bounded.** Notes are unbounded user text; a draft that can't fit the cap
 *   is reported to the caller, never silently dropped.
 * - **One owner.** The record carries the id of the user who wrote it, and a
 *   read by anyone else (or a record with no owner, from before this field)
 *   removes it instead of offering it. That is what holds on a shared device
 *   when a session lapses without a sign-out: the next person to sign in is
 *   never offered the last one's place names, and the same user's unsaved
 *   work survives an expiry.
 * - **Also cleared on sign-out** — `useAuth.ts` and `RootErrorBoundary.tsx`.
 *   Guards: `tripDraft.test.ts`, `useAuth.test.tsx`.
 */

export const TRIP_DRAFT_STORAGE_KEY = "logjam.tripDraft";

/** A draft older than this is abandoned, not unsaved. */
export const TRIP_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cap on the serialized record, in UTF-16 code units (what browsers actually
 * meter localStorage in). 64k characters is ~10,000 words of trip notes — far
 * past any real entry, while keeping a pasted logfile from eating a meaningful
 * slice of the origin's ~5 MB budget, which is shared with every other
 * `logjam.*` key.
 */
export const TRIP_DRAFT_MAX_CHARS = 64 * 1024;

/** Bumped only if the persisted shape changes; older records are dropped. */
const TRIP_DRAFT_VERSION = 1;

export type TripDraftForm = {
  date: string;
  notes: string;
  selectedPlaceIds: string[];
  displayNameInput: string;
  selectedTypes: string[];
  fieldValues: Record<string, string>;
  creating: { name: string; latitude: string; longitude: string } | null;
};

export type TripDraft = {
  version: number;
  /** Only "create" is ever written — see the module comment. */
  mode: "create";
  /** The id of the user who wrote it; a read by anyone else drops it. */
  ownerId: string;
  /** ISO timestamp of the last autosave. */
  savedAt: string;
  form: TripDraftForm;
};

export type TripDraftWriteResult =
  | { status: "saved" }
  | { status: "too-large"; chars: number }
  | { status: "failed"; error: unknown };

/**
 * Canonical serialization of the form fields, used both as the draft payload
 * and as the unsaved-changes guard's fingerprint. Key order is fixed here, once
 * — two `JSON.stringify` calls over the same fields in different orders compare
 * unequal, which would make an untouched form read as dirty.
 */
export function tripFormFingerprint(form: TripDraftForm): string {
  return JSON.stringify({
    date: form.date,
    notes: form.notes,
    selectedPlaceIds: form.selectedPlaceIds,
    displayNameInput: form.displayNameInput,
    selectedTypes: form.selectedTypes,
    fieldValues: form.fieldValues,
    creating: form.creating,
  });
}

export function isTripDraftExpired(savedAt: string, now: Date): boolean {
  const saved = Date.parse(savedAt);
  // An unparseable timestamp can't be aged, so it can't be trusted either.
  if (Number.isNaN(saved)) return true;
  return now.getTime() - saved > TRIP_DRAFT_MAX_AGE_MS;
}

/**
 * Serialize a create-mode draft. Returns the record to store, or `too-large`
 * when it exceeds the cap — the caller surfaces that rather than dropping it.
 */
export function serializeTripDraft(
  ownerId: string,
  form: TripDraftForm,
  savedAt: Date,
): { status: "ok"; raw: string } | { status: "too-large"; chars: number } {
  const draft: TripDraft = {
    version: TRIP_DRAFT_VERSION,
    mode: "create",
    ownerId,
    savedAt: savedAt.toISOString(),
    form,
  };
  const raw = JSON.stringify(draft);
  if (raw.length > TRIP_DRAFT_MAX_CHARS) {
    return { status: "too-large", chars: raw.length };
  }
  return { status: "ok", raw };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  return Object.values(value).every((v) => typeof v === "string");
}

function parseCreating(value: unknown): TripDraftForm["creating"] | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const c = value as Record<string, unknown>;
  if (
    typeof c.name !== "string" ||
    typeof c.latitude !== "string" ||
    typeof c.longitude !== "string"
  ) {
    return undefined;
  }
  return { name: c.name, latitude: c.latitude, longitude: c.longitude };
}

/**
 * Parse a stored record, returning null for anything that must not be restored:
 * corrupt JSON, a shape from another version, a non-create draft, one with no
 * owner, or an expired one. Every field is checked — this input is persisted, so it survives across
 * builds and is writable by anything running on the origin.
 */
export function parseTripDraft(
  raw: string | null,
  now: Date,
): TripDraft | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== TRIP_DRAFT_VERSION) return null;
  // The guard against restoring a create draft into an edit of another trip.
  if (record.mode !== "create") return null;
  if (typeof record.ownerId !== "string" || record.ownerId === "") return null;
  if (typeof record.savedAt !== "string") return null;
  if (isTripDraftExpired(record.savedAt, now)) return null;

  const form = record.form;
  if (typeof form !== "object" || form === null) return null;
  const f = form as Record<string, unknown>;
  if (
    typeof f.date !== "string" ||
    typeof f.notes !== "string" ||
    typeof f.displayNameInput !== "string" ||
    !isStringArray(f.selectedPlaceIds) ||
    !isStringArray(f.selectedTypes) ||
    !isStringRecord(f.fieldValues)
  ) {
    return null;
  }
  const creating = parseCreating(f.creating);
  if (creating === undefined) return null;

  return {
    version: TRIP_DRAFT_VERSION,
    mode: "create",
    ownerId: record.ownerId,
    savedAt: record.savedAt,
    form: {
      date: f.date,
      notes: f.notes,
      selectedPlaceIds: f.selectedPlaceIds,
      displayNameInput: f.displayNameInput,
      selectedTypes: f.selectedTypes,
      fieldValues: f.fieldValues,
      creating,
    },
  };
}

// ── Storage wrappers ─────────────────────────────────────────
// Thin by design: the logic above is pure and tested; these only touch
// localStorage, and every access is guarded because storage throws in hardened
// private modes.

/**
 * Read the stored draft for `ownerId`, dropping (and clearing) anything
 * unrestorable, including another user's. Never throws.
 */
export function readTripDraft(ownerId: string, now: Date): TripDraft | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(TRIP_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = parseTripDraft(raw, now);
  // Corrupt, stale, ownerless or someone else's: don't leave it to be re-read
  // every open.
  if (parsed?.ownerId !== ownerId) {
    clearTripDraft();
    return null;
  }
  return parsed;
}

/**
 * Persist a create-mode draft. Returns the outcome instead of swallowing it —
 * a draft the user believes is saved but isn't is the exact failure this
 * feature exists to prevent, so the caller surfaces both failure modes.
 */
export function writeTripDraft(
  ownerId: string,
  form: TripDraftForm,
  savedAt: Date,
): TripDraftWriteResult {
  const serialized = serializeTripDraft(ownerId, form, savedAt);
  if (serialized.status === "too-large") {
    return { status: "too-large", chars: serialized.chars };
  }
  try {
    localStorage.setItem(TRIP_DRAFT_STORAGE_KEY, serialized.raw);
    return { status: "saved" };
  } catch (err) {
    // QuotaExceededError, or storage disabled. `err` carries no draft content,
    // so logging it can't leak place names.
    return { status: "failed", error: err };
  }
}

export function clearTripDraft(): void {
  try {
    localStorage.removeItem(TRIP_DRAFT_STORAGE_KEY);
  } catch {
    // Storage unavailable — there is nothing stored to clear either.
  }
}
