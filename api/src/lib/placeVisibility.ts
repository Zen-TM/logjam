// Which columns of a place a SHAREE may see, stated as two lists that together
// have to cover the model.
//
// The rule they enforce is the hybrid share model's (root CLAUDE.md): a
// recipient sees the place RECORD, including its place-level notes and media,
// while the owner's private annotations on it do not travel. The trap is that
// this is a DENYLIST — the response spreads the row and removes what must not
// go — and a denylist's failure mode is silence: the next owner-private column
// added to `Place` reaches every sharee from the moment it exists until someone
// remembers this file.
//
// That is the `_count` lesson in the root CLAUDE.md, one column lower down. So
// the denylist is paired with a completeness guard: `placeVisibility.unit.test`
// reads the columns out of schema.prisma and fails when one appears that is
// classified by neither list. A new column cannot leak by omission — it cannot
// be added at all without someone answering the question.
//
// Why a denylist and not a `select`: a select is a second list to keep in step
// with the schema, and every column it forgets is a feature that silently does
// not work for sharees. This way the default is "visible", which is right for a
// record the recipient is entitled to see, and the exceptions are named with
// their reasons.

/**
 * Owner-private columns, each with the reason it is one. Present in the owner's
 * own responses; stripped from everything a sharee can reach.
 */
export const OWNER_PRIVATE_PLACE_FIELDS: Record<string, string> = {
  // §2.6. Holds what the SENDER's definitions said about values this owner has
  // no definition for. Re-emitting it down a share chain is the propagation
  // objection that got the "append it to notes" design rejected: B copies A's
  // place, B shares it with C, and C reads A's field labels and values. A
  // sharee gets `fieldDefsSnapshot` instead — derived live from the OWNER's
  // current definitions, so it says what THIS place's values mean and nothing
  // about anyone else's schema.
  foreignFields:
    "another user's field labels and values, carried in on a copy (§2.6)",
  // The importer's idempotency keys. Not sensitive in themselves, but they are
  // the owner's filing system: `importKey` is derived from name+coords and
  // `importBatchId` groups one import run, so together they tell a recipient
  // how and when the owner bulk-loaded their data.
  importKey: "import idempotency key — the owner's filing, not the record",
  importBatchId: "groups one import run of the owner's",
};

/**
 * Columns a sharee sees. Not used to build the response — the response spreads
 * the row — but stated so the guard can prove the two lists cover the model
 * between them, and so that adding a column is a decision rather than a
 * default.
 */
export const SHAREE_VISIBLE_PLACE_FIELDS: readonly string[] = [
  "id",
  // The owner's id is how a client resolves "From <name>" on a shared row; it
  // is already in every share row the recipient holds.
  "ownerId",
  "placeTypeId",
  "name",
  "altNames",
  "latitude",
  "longitude",
  "elevation",
  "tags",
  // Place-level notes ARE shared (the hybrid model's central distinction —
  // per-TRIP notes are not).
  "notes",
  "fieldValues",
  "createdAt",
  "updatedAt",
  // Lineage. A copy points at what it was copied from, which the recipient can
  // already see or cannot resolve — either way it names no content.
  "forkedFromId",
  // Public RopeWiki identity and text, not user-authored.
  "ropeWikiId",
  "ropeWikiSnapshot",
];

/**
 * A place as its RECIPIENT may see it.
 *
 * Reads the denylist rather than naming one field, so a column classified
 * owner-private above is stripped by the act of classifying it — the map is
 * load-bearing, not documentation.
 */
export function serializeSharedPlace<T extends Record<string, unknown>>(
  place: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(place) as [keyof T, T[keyof T]][]) {
    // `in` rather than Object.hasOwn: this package targets ES2020, and the
    // map is a literal with no prototype surprises to guard against.
    if ((key as string) in OWNER_PRIVATE_PLACE_FIELDS) continue;
    out[key] = value;
  }
  return out;
}
