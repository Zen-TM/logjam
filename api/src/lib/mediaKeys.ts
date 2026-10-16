// Where a media object lives in S3, and the ONLY place that decides.
//
// Both routes/media.ts and place copy mint keys (a copied photo is a new
// object under the COPIER's prefix). A single implementation guarantees
// mediaOrphanSweeper.ts matches keys when reading back out of the bucket:
// a key minted to a different shape is either swept while live or never swept.
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
