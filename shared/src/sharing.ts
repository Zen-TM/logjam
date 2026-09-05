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

// ── The per-friend sharing audit ─────────────────────────────────────────────
//
// "What does Bob see, and how do I take it back?" — the question sharing is
// never authored from, because a share is granted per item from that item's own
// sheet. GET /friends/:id/shares answers it from the PERSON's side, in both
// directions, and DELETE /friends/:id/shares is the bulk revoke of the forward
// one.
//
// A ROW IS NOT A CANYON. The payload used to be canyon-only (`canyonId`), which
// made the surface understate itself the moment direct item sharing shipped:
// waypoints, routes, LiDAR topos and GeoPDFs live in the `Share` table, and a
// friend holding six of them saw an audit screen that said "nothing shared".
// The row therefore carries the same (entityType, entityId) pair the bulk share
// speaks, so the two halves of the feature cannot disagree about what a
// shareable thing is.
//
// WHAT IT STILL DOES NOT SAY: a shared canyon carries its canyon-level notes,
// its canyon-level media and its linked route with it, and a waypoint linked to
// it inherits visibility with no `Share` row of its own. Those are not rows
// here and cannot be revoked individually — unsharing the CANYON is what takes
// them back. Every surface listing these rows has to say so, or the user
// unshares three waypoints and believes the friend is blind.

/**
 * One thing one friend can see, in either direction.
 *
 * `name` is nullable because a job may be untitled (a LiDAR topo with no name,
 * a GeoPDF whose config carried no title) — `shareRowTitle` is the one place
 * that decides what an untitled row is called.
 */
export type FriendShareRow = {
  entityType: BulkShareItemType;
  entityId: string;
  name: string | null;
  sharedAt: string;
  /**
   * RECEIVED ROWS ONLY: this row is ALSO visible through a canyon its owner
   * shared, so dropping its direct share would change nothing — the canyon arm
   * survives and the next delta pull brings the row straight back.
   *
   * The SERVER answers this, because only the server can. A client deriving it
   * from its own mirror is right only once the mirror has pulled the linked
   * row: on a phone that had not yet synced, the same waypoint offered a Remove
   * that would silently undo itself (seen on device, 2026-09-05).
   */
  alsoViaCanyon?: true;
};

export type FriendShares = {
  /** Things I own that this friend can see. Mine to revoke, in bulk or one at a time. */
  sharedWithThem: FriendShareRow[];
  /** Things this friend owns that I can see. Theirs to withdraw; mine to drop. */
  sharedWithYou: FriendShareRow[];
};

/**
 * The kind, lower-case, as it reads mid-sentence — "canyon", "topo", "GeoPDF".
 *
 * Feeds `removeShareConfirm`'s `kindLabel` and the row subtitles on both
 * clients, so a kind cannot be worded two ways on two screens. A
 * `Record<BulkShareItemType, …>` on purpose: a sixth shareable kind cannot be
 * added without naming it here.
 */
export const SHARE_KIND_LABEL: Record<BulkShareItemType, string> = {
  canyon: "canyon",
  waypoint: "waypoint",
  route: "route",
  topoJob: "topo",
  geoPdfJob: "GeoPDF",
};

/** What an audit row is called, untitled jobs included. */
export function shareRowTitle(row: FriendShareRow): string {
  return row.name ?? `Untitled ${SHARE_KIND_LABEL[row.entityType]}`;
}

/**
 * Whether a row someone else shared with me can be COPIED into my own account.
 *
 * Canyons only, because `POST /canyons/:id/copy` is the only copy the API has.
 *
 * TODO: waypoints and routes deserve the same verb — a shared waypoint you want
 * to keep can currently only be removed, never kept. That needs
 * `POST /waypoints/:id/copy` and `POST /routes/:id/copy` (read via
 * shareAccess, create as the caller) plus the local mirror insert, so it is a
 * feature of its own rather than a widening of this predicate. Jobs stay
 * uncopyable regardless: they are S3 artefacts with a quota charge, not rows.
 */
export function isCopyableSharedRow(row: FriendShareRow): boolean {
  return row.entityType === "canyon";
}

// ── Getting rid of something shared WITH you ─────────────────────────────────
//
// The recipient's half of both share tables. `DELETE /canyons/:id/share/me` and
// `DELETE /shares/:entityType/:entityId/me` have always accepted a recipient
// revoking their own access; what follows is the ONE statement of when a client
// may offer that, and the one wording it offers it with.
//
// Why it is not simply "is this row shared with me": a waypoint or a route can
// be visible for TWO unrelated reasons (api/src/lib/shareAccess.ts) — a direct
// `Share` row, or a link to a canyon shared with the caller. Revoking the
// direct row leaves the canyon arm standing, so a Remove offered on an
// inherited row would appear to work and bring the row straight back on the
// next pull. What came with a canyon is removed by removing THAT canyon, and
// the surfaces say so rather than offering a verb that cannot deliver.

/**
 * Why a row someone else owns is visible to this user — and therefore what, if
 * anything, they can do about it.
 *
 * "direct"     → a share row of their own: Remove is theirs to use.
 * "via-canyon" → it arrived with a shared canyon: point at that canyon.
 * "owned"      → theirs; not a share at all.
 */
export type SharedRowVisibility = "owned" | "direct" | "via-canyon";

export function sharedRowVisibility(row: {
  /**
   * The server's own word for the caller's relationship to the row. Typed wide
   * because the mobile mirror stores it as a nullable text column (a row synced
   * before the field existed, or one rebuilt offline, carries no role) —
   * anything that is not exactly "shared" is treated as the caller's own, so an
   * unknown role never produces a Remove that the server would refuse.
   */
  syncRole: string | null | undefined;
  /**
   * Canyons THE CALLER CAN SEE that this row is linked to. Empty — or omitted,
   * for the kinds with no canyon link at all (topo and GeoPDF jobs) — means no
   * inherited arm exists, so a direct share is the whole reason it is here.
   *
   * Both clients already hold this: a waypoint's `canyonIds` is server-scoped
   * to canyons the caller can see, and a route's single `canyonId` counts only
   * when that canyon is in the caller's own canyon list.
   */
  visibleLinkedCanyonIds?: readonly string[];
}): SharedRowVisibility {
  if (row.syncRole !== "shared") return "owned";
  return (row.visibleLinkedCanyonIds ?? []).length > 0 ? "via-canyon" : "direct";
}

/**
 * The confirm every surface shows before a recipient removes a share.
 *
 * ONE wording, because six surfaces ask this question and the promise is easy
 * to get wrong in either direction: it is NOT a delete (the owner's row is
 * untouched, so nothing here may say "permanently" or "cannot be undone"), and
 * it is NOT local (the revoke is server-side, so it reaches every device, and
 * neither Logjam Web nor Logjam GPS may be named as the place it happens).
 *
 * The verb is Remove everywhere, never Delete: a recipient tapping Delete on
 * someone else's canyon has every reason to fear they are destroying the
 * original.
 */
export function removeShareConfirm(args: {
  /** Lower-case kind as it reads mid-sentence: "canyon", "waypoint", "topo". */
  kindLabel: string;
  itemName: string;
  /** The owner's username, on the surfaces that know it. */
  ownerName?: string | null;
}): { title: string; body: string } {
  const owner = args.ownerName ?? "The owner";
  return {
    title: `Remove shared ${args.kindLabel}?`,
    body:
      `“${args.itemName}” is removed from your account, on every device. ` +
      `${owner} keeps the original — ask them to share it again if you want it back.`,
  };
}
