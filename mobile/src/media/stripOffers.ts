/**
 * What a media strip lets the viewer do. A read-only strip is a place someone
 * else owns: the API refuses every attach and delete there (`assertOwnsTarget`),
 * so offering either only ends in a sync issue.
 */
export function stripOffers(strip: {
  readOnly?: boolean;
  atLimit: boolean;
  hasAddWay: boolean;
}): { add: boolean; remove: boolean } {
  if (strip.readOnly) return { add: false, remove: false };
  return { add: !strip.atLimit || strip.hasAddWay, remove: true };
}
