// Direct per-item sharing — the vocabulary both clients and the API read.
//
// TWO DIFFERENT PROMISES live in this file, and the words for them are not
// interchangeable:
//
//   SHARE ("Share")        — a live, revocable view of a row the sender still
//                            owns. The recipient sees the sender's copy; the
//                            sender can take it back; the recipient can never
//                            edit it. Waypoints, routes, LiDAR topos, GeoPDFs.
//
//   SEND A COPY ("Send a   — a file handed over. Once accepted it is the
//   copy")                   recipient's own, editable, permanent, and NOT
//                            revocable. Imported GPX/KML, recorded tracks.
//
// A UI that words these the same way teaches users that a sent file can be
// taken back, which it cannot. Keep the two verbs distinct everywhere.

/**
 * What a `Share` row may point at.
 *
 * Canyons are absent deliberately: they keep `CanyonShare`, which is
 * load-bearing in sync, notifications and tombstones. Two tables, ONE reader —
 * `api/src/lib/shareAccess.ts` unions them, and nothing else re-derives the
 * decision (root CLAUDE.md, SEC-001).
 */
export const SHARABLE_ENTITY_TYPES = [
  "waypoint",
  "route",
  "topoJob",
  "geoPdfJob",
] as const;

export type SharableEntityType = (typeof SHARABLE_ENTITY_TYPES)[number];

export function isSharableEntityType(
  value: unknown,
): value is SharableEntityType {
  return (
    typeof value === "string" &&
    (SHARABLE_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

/**
 * What a sent file was made from. Drives the recipient's provenance line and
 * nothing else — the bytes are the bytes.
 */
export const FILE_SEND_SOURCE_KINDS = ["import", "track"] as const;
export type FileSendSourceKind = (typeof FILE_SEND_SOURCE_KINDS)[number];

/**
 * Per-recipient state of one send.
 *
 * The download gate reads THIS, never the S3 object's existence: one object
 * serves every recipient of a send, so "declined" has to be a property of the
 * recipient rather than of the bytes. Deleting the object when one person
 * declines (or accepts) strands everyone else on the same send.
 */
export const FILE_SEND_STATUSES = ["pending", "accepted", "declined"] as const;
export type FileSendStatus = (typeof FILE_SEND_STATUSES)[number];

/**
 * How long sent bytes live before the S3 lifecycle rule removes them and the
 * reaper sweeps the rows. A week is long enough that a friend who is out of
 * signal for a trip still gets the file, short enough that unclaimed sends do
 * not accumulate against the sender's quota.
 *
 * The S3 lifecycle rule on the prefix is the thing that actually deletes the
 * object; this constant must stay >= that rule's expiry, or a row can outlive
 * its bytes and offer the recipient a download that 404s.
 */
export const FILE_SEND_TTL_DAYS = 7;

/**
 * Cap on a sent file.
 *
 * The invariant is "anything importable is sendable" — the recipient's accept
 * runs the same import the sender's file came through, so a send cap below an
 * import cap creates files a user can hold but not pass on, which is a worse
 * thing to explain than a big upload.
 *
 * Mobile has TWO import ceilings and this is the larger: vector files stop at
 * MAX_IMPORT_FILE_BYTES = 30 MB (imports/vectorImports.ts), GeoPDFs at
 * MAX_GEOPDF_FILE_BYTES = 64 MB (geopdf/importPipeline.ts). Raising either one
 * means raising this.
 */
export const FILE_SEND_MAX_BYTES = 64 * 1024 * 1024;

/** Display filename cap. The one user-supplied string on a send — never logged. */
export const FILE_SEND_FILENAME_MAX_LENGTH = 255;

// ── Bulk share ───────────────────────────────────────────────────────────────
//
// ONE user action — "share these 23 things with these 3 friends" — spanning
// BOTH verbs above. The mechanism is picked per item and never by the user:
// a waypoint gets a Share, a recorded track gets a Send a copy, because that
// is the only thing each kind supports. The UI's job is to say which items
// went which way BEFORE the action runs (the confirm), not to make the user
// choose.

/**
 * What one bulk-share line may point at.
 *
 * `canyon` is admitted HERE and nowhere else: a canyon share is a `CanyonShare`
 * row, not a `Share` row (see `SHARABLE_ENTITY_TYPES` above), and the bulk
 * endpoint is the one caller that fans a mixed list across both tables. Keeping
 * the union bulk-only stops "canyon" leaking into `SHARABLE_ENTITY_TYPES`,
 * where it would silently widen `/shares` to a table it cannot write.
 */
export const BULK_SHARE_ITEM_TYPES = [
  ...SHARABLE_ENTITY_TYPES,
  "canyon",
] as const;

export type BulkShareItemType = (typeof BULK_SHARE_ITEM_TYPES)[number];

export function isBulkShareItemType(
  value: unknown,
): value is BulkShareItemType {
  return (
    typeof value === "string" &&
    (BULK_SHARE_ITEM_TYPES as readonly string[]).includes(value)
  );
}

export type BulkShareItem = {
  entityType: BulkShareItemType;
  entityId: string;
};

/**
 * Cap on one bulk-share request.
 *
 * A bound, not a product decision — the same reason `MAX_RECIPIENTS_PER_SEND`
 * exists. With the recipient cap this is 200 x 25 = 5000 share rows per
 * request, which is one `createMany` per table, not 5000 round trips.
 */
export const MAX_BULK_SHARE_ITEMS = 200;

/**
 * What a bulk share DID, in counts and nothing else.
 *
 * Deliberately not per-id: an id-keyed result ("that one wasn't yours") is an
 * existence oracle on ids the caller may have guessed, which is the rule
 * `/shares` already follows by answering 404 rather than 403 (SEC-001). The
 * caller supplied the list, so it can label its own rows from the totals.
 */
export type BulkShareResult = {
  /** New share rows written, summed over items x recipients. */
  granted: number;
  /** Pairs that already existed — re-sharing is a no-op, never an error. */
  alreadyShared: number;
  /**
   * Items the sender may not share (not theirs, or gone since the list was
   * built), summed over recipients. Never says WHICH.
   */
  ineligible: number;
};
