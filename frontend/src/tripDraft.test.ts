import { describe, it, expect, beforeEach } from "vitest";
import {
  TRIP_DRAFT_MAX_AGE_MS,
  TRIP_DRAFT_MAX_CHARS,
  TRIP_DRAFT_STORAGE_KEY,
  clearTripDraft,
  isTripDraftExpired,
  parseTripDraft,
  readTripDraft,
  serializeTripDraft,
  tripFormFingerprint,
  writeTripDraft,
  type TripDraftForm,
} from "./tripDraft";

const NOW = new Date("2026-07-16T09:00:00.000Z");

function form(overrides: Partial<TripDraftForm> = {}): TripDraftForm {
  return {
    date: "2026-07-14",
    notes: "Cold swims, one hang re-rigged.",
    selectedCanyonIds: ["canyon-1"],
    displayNameInput: "",
    selectedTypes: ["canyoning"],
    fieldValues: { water: "high" },
    creating: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("tripFormFingerprint", () => {
  it("is stable across key insertion order", () => {
    // The guard compares two independently-built objects; if key order leaked
    // into the fingerprint an untouched form would read as dirty.
    const a: TripDraftForm = {
      date: "2026-07-14",
      notes: "n",
      selectedCanyonIds: [],
      displayNameInput: "",
      selectedTypes: [],
      fieldValues: {},
      creating: null,
    };
    const b = {
      creating: null,
      fieldValues: {},
      selectedTypes: [],
      displayNameInput: "",
      selectedCanyonIds: [],
      notes: "n",
      date: "2026-07-14",
    } as TripDraftForm;
    expect(tripFormFingerprint(a)).toBe(tripFormFingerprint(b));
  });

  it("changes when a field changes", () => {
    expect(tripFormFingerprint(form())).not.toBe(
      tripFormFingerprint(form({ notes: "edited" })),
    );
  });
});

describe("isTripDraftExpired", () => {
  it("keeps a draft inside the window", () => {
    const savedAt = new Date(NOW.getTime() - TRIP_DRAFT_MAX_AGE_MS + 1000).toISOString();
    expect(isTripDraftExpired(savedAt, NOW)).toBe(false);
  });

  it("expires a draft past the window", () => {
    const savedAt = new Date(NOW.getTime() - TRIP_DRAFT_MAX_AGE_MS - 1000).toISOString();
    expect(isTripDraftExpired(savedAt, NOW)).toBe(true);
  });

  it("expires a three-month-old draft", () => {
    expect(isTripDraftExpired("2026-04-16T09:00:00.000Z", NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as expired", () => {
    expect(isTripDraftExpired("last tuesday", NOW)).toBe(true);
  });
});

describe("serializeTripDraft", () => {
  it("round-trips through parseTripDraft", () => {
    const serialized = serializeTripDraft(form(), NOW);
    expect(serialized.status).toBe("ok");
    if (serialized.status !== "ok") return;
    const parsed = parseTripDraft(serialized.raw, NOW);
    expect(parsed).not.toBeNull();
    expect(parsed!.form).toEqual(form());
    expect(parsed!.savedAt).toBe(NOW.toISOString());
    expect(parsed!.mode).toBe("create");
  });

  it("round-trips a pending inline canyon create", () => {
    const withCreate = form({
      creating: { name: "Unnamed", latitude: "-33.1", longitude: "150.2" },
    });
    const serialized = serializeTripDraft(withCreate, NOW);
    if (serialized.status !== "ok") throw new Error("expected ok");
    expect(parseTripDraft(serialized.raw, NOW)!.form).toEqual(withCreate);
  });

  it("reports a draft over the size cap instead of storing it", () => {
    const huge = form({ notes: "x".repeat(TRIP_DRAFT_MAX_CHARS + 1) });
    const serialized = serializeTripDraft(huge, NOW);
    expect(serialized.status).toBe("too-large");
    if (serialized.status !== "too-large") return;
    expect(serialized.chars).toBeGreaterThan(TRIP_DRAFT_MAX_CHARS);
  });

  it("accepts a draft just under the cap", () => {
    const big = form({ notes: "x".repeat(TRIP_DRAFT_MAX_CHARS - 500) });
    expect(serializeTripDraft(big, NOW).status).toBe("ok");
  });
});

describe("parseTripDraft", () => {
  const validRaw = () => {
    const s = serializeTripDraft(form(), NOW);
    if (s.status !== "ok") throw new Error("expected ok");
    return s.raw;
  };

  it("returns null for a missing value", () => {
    expect(parseTripDraft(null, NOW)).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    expect(parseTripDraft("{not json", NOW)).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    expect(parseTripDraft(JSON.stringify("a string"), NOW)).toBeNull();
  });

  it("returns null for an expired draft", () => {
    const stale = new Date(NOW.getTime() - TRIP_DRAFT_MAX_AGE_MS - 1);
    const s = serializeTripDraft(form(), stale);
    if (s.status !== "ok") throw new Error("expected ok");
    expect(parseTripDraft(s.raw, NOW)).toBeNull();
  });

  it("returns null for a record from another version", () => {
    const record = JSON.parse(validRaw());
    record.version = 2;
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });

  it("refuses a draft that is not create-mode", () => {
    // The data-corruption guard: an edit-scoped record must never repopulate
    // the create form (or vice versa).
    const record = JSON.parse(validRaw());
    record.mode = "edit";
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });

  it("refuses a record with no mode at all", () => {
    const record = JSON.parse(validRaw());
    delete record.mode;
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });

  it.each([
    ["date", 20260714],
    ["notes", null],
    ["displayNameInput", { a: 1 }],
    ["selectedCanyonIds", "canyon-1"],
    ["selectedTypes", [1, 2]],
    ["fieldValues", ["water"]],
    ["creating", "yes"],
  ])("returns null when form.%s has the wrong type", (key, value) => {
    const record = JSON.parse(validRaw());
    record.form[key] = value;
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });

  it("returns null when the canyon id array holds non-strings", () => {
    const record = JSON.parse(validRaw());
    record.form.selectedCanyonIds = ["ok", 7];
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });

  it("returns null when a pending create is missing a field", () => {
    const record = JSON.parse(validRaw());
    record.form.creating = { name: "Unnamed", latitude: "-33.1" };
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });

  it("returns null when the form is missing entirely", () => {
    const record = JSON.parse(validRaw());
    delete record.form;
    expect(parseTripDraft(JSON.stringify(record), NOW)).toBeNull();
  });
});

describe("storage wrappers", () => {
  it("writes then reads back a draft", () => {
    expect(writeTripDraft(form(), NOW)).toEqual({ status: "saved" });
    const draft = readTripDraft(NOW);
    expect(draft).not.toBeNull();
    expect(draft!.form).toEqual(form());
  });

  it("does not write a draft over the cap", () => {
    const result = writeTripDraft(form({ notes: "x".repeat(TRIP_DRAFT_MAX_CHARS) }), NOW);
    expect(result.status).toBe("too-large");
    expect(localStorage.getItem(TRIP_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("reports a storage write failure rather than swallowing it", () => {
    const quotaError = new Error("QuotaExceededError");
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw quotaError;
    };
    try {
      expect(writeTripDraft(form(), NOW)).toEqual({ status: "failed", error: quotaError });
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });

  it("clears an expired draft on read instead of re-reading it every open", () => {
    const stale = new Date(NOW.getTime() - TRIP_DRAFT_MAX_AGE_MS - 1);
    writeTripDraft(form(), stale);
    expect(readTripDraft(NOW)).toBeNull();
    expect(localStorage.getItem(TRIP_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("clears a corrupt draft on read", () => {
    localStorage.setItem(TRIP_DRAFT_STORAGE_KEY, "{not json");
    expect(readTripDraft(NOW)).toBeNull();
    expect(localStorage.getItem(TRIP_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("returns null when nothing is stored, leaving storage alone", () => {
    expect(readTripDraft(NOW)).toBeNull();
  });

  it("clearTripDraft removes the key", () => {
    writeTripDraft(form(), NOW);
    clearTripDraft();
    expect(localStorage.getItem(TRIP_DRAFT_STORAGE_KEY)).toBeNull();
  });
});
