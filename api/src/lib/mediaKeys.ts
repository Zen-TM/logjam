// Where a media object lives in S3, and the ONLY place that decides.
//
// It used to be a module-private helper in routes/media.ts, which was fine
// while one route minted keys. The place copy mints them too (a copied photo is
// a new object under the COPIER's prefix), and a second implementation would
// break a statement other code already depends on: mediaOrphanSweeper.ts reads
// `media/<ownerId>/<mediaId>/<basename>` back out of the bucket and deletes
// what it cannot match to a row. A key minted to a different shape there is
// either swept while live or never swept at all.
//
// Derived entirely from SERVER-SIDE values (ownerId + mediaId + MIME), so no
// caller can point an operation at someone else's object.
import { MEDIA_EXTENSION_BY_MIME } from "@logjam/shared";

export function mediaKeys(ownerId: string, mediaId: string, mediaType: string) {
  const ext = MEDIA_EXTENSION_BY_MIME[mediaType];
  return {
    displayKey: `media/${ownerId}/${mediaId}/display.${ext}`,
    thumbnailKey: `media/${ownerId}/${mediaId}/thumb.jpg`,
  };
}
