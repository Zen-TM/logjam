// The arithmetic of one bulk share, with no database in it.
//
// "Share these 23 things with these 3 friends" is a cross product with three
// outcomes per cell — grant it, skip it because it already exists, skip it
// because the item is not the sender's to give — and the route's job is only
// to fetch the two facts this needs (what the sender owns, what is already
// shared) and to write what comes back. The counting is here because counting
// is what goes wrong: an `alreadyShared` tally that double-counts, or an
// `ineligible` one that forgets to multiply by the recipients, is invisible in
// a passing integration test and lands in the user's confirmation sentence.
//
// PRIVACY: the result is COUNTS. Never a per-id verdict — "that one wasn't
// yours" on an id the caller supplied is an existence oracle, which is the same
// rule that makes /shares answer 404 rather than 403 (SEC-001). The caller
// supplied the list, so it can label its own rows from the totals.
import {
  isBulkShareItemType,
  MAX_BULK_SHARE_ITEMS,
  type BulkShareItem,
  type BulkShareItemType,
  type BulkShareResult,
} from "@logjam/shared";

import { AppError } from "../middleware/errorHandler";

/** The key an existing (item, recipient) share pair is looked up by. */
export function sharePairKey(
  entityType: BulkShareItemType,
  entityId: string,
  sharedWithId: string,
): string {
  return `${entityType}:${entityId}:${sharedWithId}`;
}

export type BulkShareGrant = {
  entityType: BulkShareItemType;
  entityId: string;
  sharedWithId: string;
};

export type BulkSharePlan = {
  /** Every share row to write, across both tables. */
  grants: BulkShareGrant[];
  /**
   * Ids that gained at least one grant, per type — the rows whose `updatedAt`
   * must be bumped.
   *
   * A GRANT MOVES NO WATERMARK ON ITS OWN. Delta sync restricts shared rows by
   * a WHERE clause layered over `updatedAt > since`, so making a row visible
   * leaves it out of the recipient's next page until the owner happens to edit
   * it. Both single-item share paths learned this the hard way (the note on
   * `touchForDelta` in routes/shares.ts, and the longer one in
   * routes/sharing.ts); bulk would have re-learned it 23 rows at a time.
   */
  touchedIdsByType: Map<BulkShareItemType, string[]>;
  result: BulkShareResult;
};

/**
 * Validate the `items` array of a bulk-share request.
 *
 * An empty list is ALLOWED here and rejected by the route only when there is
 * nothing else in the action either: a bulk share of ten recorded tracks is all
 * copies and grants no shares at all, and it still needs the endpoint for the
 * single push it fires. Oversized is 413, per the api/CLAUDE.md bulk rule.
 */
export function parseBulkShareItems(value: unknown): BulkShareItem[] {
  if (!Array.isArray(value)) {
    throw new AppError(400, "items must be an array");
  }
  if (value.length > MAX_BULK_SHARE_ITEMS) {
    throw new AppError(
      413,
      `At most ${MAX_BULK_SHARE_ITEMS} items can be shared at once`,
    );
  }
  const seen = new Set<string>();
  const items: BulkShareItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      throw new AppError(400, "items must be objects");
    }
    const { entityType, entityId } = raw as Record<string, unknown>;
    if (!isBulkShareItemType(entityType)) {
      throw new AppError(400, "Unknown item entityType");
    }
    if (typeof entityId !== "string" || entityId.length === 0) {
      throw new AppError(400, "items must carry an entityId");
    }
    // A list the user built by tapping rows cannot contain the same row twice,
    // so a duplicate is a client bug — dropped rather than rejected, because
    // failing the whole action over it would lose the other 22 items. Deduping
    // also keeps `granted` honest: `skipDuplicates` would silently swallow the
    // second copy and the count would claim a row that was never written.
    const key = `${entityType}:${entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ entityType, entityId });
  }
  return items;
}

/**
 * Decide what to write, given what the sender owns and what is already shared.
 *
 * `ownedIdsByType` holds only the ids the sender OWNS — a sharee may not
 * re-share, so anything absent is ineligible whether it is someone else's or
 * does not exist at all. Those two are indistinguishable on purpose.
 */
export function planBulkShare({
  items,
  recipientIds,
  ownedIdsByType,
  existingPairKeys,
}: {
  items: BulkShareItem[];
  recipientIds: string[];
  ownedIdsByType: Map<BulkShareItemType, Set<string>>;
  existingPairKeys: ReadonlySet<string>;
}): BulkSharePlan {
  const grants: BulkShareGrant[] = [];
  const touchedIdsByType = new Map<BulkShareItemType, string[]>();
  let alreadyShared = 0;
  let ineligible = 0;

  for (const item of items) {
    const owned = ownedIdsByType.get(item.entityType)?.has(item.entityId);
    if (!owned) {
      // Per RECIPIENT, not per item: the caller asked for `recipients` grants
      // on this row and got none of them, and a confirmation that counted this
      // once would not add up against `granted`.
      ineligible += recipientIds.length;
      continue;
    }
    let granted = false;
    for (const sharedWithId of recipientIds) {
      if (existingPairKeys.has(sharePairKey(item.entityType, item.entityId, sharedWithId))) {
        alreadyShared += 1;
        continue;
      }
      grants.push({
        entityType: item.entityType,
        entityId: item.entityId,
        sharedWithId,
      });
      granted = true;
    }
    if (granted) {
      const list = touchedIdsByType.get(item.entityType) ?? [];
      list.push(item.entityId);
      touchedIdsByType.set(item.entityType, list);
    }
  }

  return {
    grants,
    touchedIdsByType,
    result: { granted: grants.length, alreadyShared, ineligible },
  };
}
