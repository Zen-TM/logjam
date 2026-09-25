/**
 * The server's REST response shapes, as both clients see them.
 *
 * These lived twice — `frontend/src/placeUtils.ts` and `mobile/src/api/types.ts`
 * — as two hand-maintained copies of one contract kept in step by a comment.
 * They are declared here once; both clients re-export them from their old
 * homes, so every existing import keeps working and neither copy can drift.
 *
 * Wire shapes only: no logic, no client-specific fields. The SYNC protocol's
 * row shapes are a different contract and live in `sync.ts` — a mirror row is
 * not a REST response (different endpoints, different visibility scoping).
 */
import type { PlaceMergePolicy } from "./mergePlace.js";
import type { MediaItem } from "./media.js";
import type {
  NotificationPreferences,
  ThemeSchemeId,
} from "./themeSchemes.js";
import type { ForeignFieldValue } from "./fieldValues.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

export type TPlace = {
  id: string;
  ownerId: string;
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
  placeTypeId: string;
  notes: string | null;
  /** Metres. Came in with the phase 1c waypoint fold — a canyon has never
   *  carried one, a marker usually does. */
  elevation: number | null;
  /** Type-specific values, keyed by CustomFieldDef.key. Replaces the seven
   *  grade columns and the free-form `attributes` blob; internal `_`-prefixed
   *  keys (`_sources` today) are not user fields. */
  fieldValues: Record<string, unknown>;
  /** Values that came in on a copy keyed by definitions this owner does not
   *  have. OWNER-PRIVATE — never present on a place shared WITH the viewer. */
  foreignFields?: ForeignFieldValue[] | null;
  ropeWikiId: number | null;
  /** The place this one was copied from, or null. Says which of the two ways a
   *  value came to not fit this type. */
  forkedFromId?: string | null;
  /** The other end of every link touching this place. OWNER-PRIVATE and
   *  present on the OWNED list and the owner's detail response only: a link
   *  grants no visibility, and a sharee must not learn which other places the
   *  owner filed this one against. Absent means "not yours to know", never
   *  "no links" — the same rule `_count` below follows. */
  linkedPlaceIds?: string[];
  createdAt: string;
  updatedAt: string;
  // Populated only by the place-detail endpoint (GET /places/:id), not the list.
  media?: MediaItem[];
  // Populated only by the OWNED list (GET /places) — never by GET /places/shared
  // and never by the detail endpoint. `shares` powers the "shared by me" filter +
  // the card badge; `tripLogLinks` the completion filter + per-row trip count.
  //
  // Optional because on a place shared WITH you these counts are absent by
  // design, not zero: the trip tally is the owner's private trip-list
  // cardinality and `shares` is their fan-out to other people, so the API
  // withholds both (see placeListInclude in api/src/routes/places.ts). Absent
  // means "not yours to know" — so never coalesce it to 0 and present that as an
  // answer about a shared place. Gate every read on ownership.
  _count?: { tripLogLinks: number; shares: number };
};

export type TUser = {
  id: string;
  username: string;
  email: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  /** Monthly worker allowance and usage, in credits (= vCPU-minutes). See
   * computeCredits.ts. Replaced the tile quota, which only covered the topo
   * worker and did not measure cost. */
  monthlyComputeCredits: number;
  monthlyComputeUsage: number;
  monthlyComputeResetAt: string;
  /** Monthly download allowance, as decimal strings — these exceed Number's
   * safe integer range in principle and are only ever compared or formatted. */
  monthlyEgressQuotaBytes: string;
  monthlyEgressUsedBytes: string;
  consentedAt: string | null;
  consentVersion: string | null;
  uiPreferences?: {
    themeSchemeId?: ThemeSchemeId;
    tripLogCustomFields?: TripLogCustomFieldDef[];
    placeCustomFields?: TripLogCustomFieldDef[];
    notifications?: NotificationPreferences;
    autoDownloadGeoPdfs?: boolean;
    importMergePolicy?: PlaceMergePolicy;
    copyPlaceMedia?: boolean;
  } | null;
};

export type TTripLog = {
  id: string;
  // Ordered — order is meaningful, drives the derived title (see tripTitle).
  places: { id: string; name: string }[];
  userId: string;
  date: string;
  displayName: string | null;
  types: string[];
  notes: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  // Populated by the per-place trip endpoints (GET /places/:id/trips[/:id]).
  media?: MediaItem[];
};

export type TNotification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};
