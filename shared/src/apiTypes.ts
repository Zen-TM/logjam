/**
 * The server's REST response shapes, as both clients see them.
 *
 * These lived twice — `frontend/src/canyonUtils.ts` and `mobile/src/api/types.ts`
 * — as two hand-maintained copies of one contract kept in step by a comment.
 * They are declared here once; both clients re-export them from their old
 * homes, so every existing import keeps working and neither copy can drift.
 *
 * Wire shapes only: no logic, no client-specific fields. The SYNC protocol's
 * row shapes are a different contract and live in `sync.ts` — a mirror row is
 * not a REST response (different endpoints, different visibility scoping).
 */
import type { CanyonMergePolicy } from "./mergeCanyon.js";
import type { MediaItem } from "./media.js";
import type {
  NotificationPreferences,
  ThemeSchemeId,
} from "./themeSchemes.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

export type TCanyonAttributes = {
  sources?: [string, string][];
  customFields?: Record<string, unknown>;
};

export type TCanyon = {
  id: string;
  ownerId: string;
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  quality: number | null;
  hours: number | null;
  notes: string | null;
  attributes: TCanyonAttributes;
  ropeWikiId: number | null;
  createdAt: string;
  updatedAt: string;
  // Populated only by the canyon-detail endpoint (GET /canyons/:id), not the list.
  media?: MediaItem[];
  // Populated only by the OWNED list (GET /canyons) — never by GET /canyons/shared
  // and never by the detail endpoint. `shares` powers the "shared by me" filter +
  // the card badge; `tripLogLinks` the completion filter + per-row trip count.
  //
  // Optional because on a canyon shared WITH you these counts are absent by
  // design, not zero: the trip tally is the owner's private trip-list
  // cardinality and `shares` is their fan-out to other people, so the API
  // withholds both (see canyonListInclude in api/src/routes/canyons.ts). Absent
  // means "not yours to know" — so never coalesce it to 0 and present that as an
  // answer about a shared canyon. Gate every read on ownership.
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
    canyonCustomFields?: TripLogCustomFieldDef[];
    notifications?: NotificationPreferences;
    autoDownloadGeoPdfs?: boolean;
    importMergePolicy?: CanyonMergePolicy;
  } | null;
};

export type TTripLog = {
  id: string;
  // Ordered — order is meaningful, drives the derived title (see tripTitle).
  canyons: { id: string; name: string }[];
  userId: string;
  date: string;
  displayName: string | null;
  types: string[];
  notes: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  // Populated by the per-canyon trip endpoints (GET /canyons/:id/trips[/:id]).
  media?: MediaItem[];
};

export type TNotification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};
