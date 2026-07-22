// API response shapes consumed by the mobile client — mirrors the server
// responses and the web client's types in frontend/src/canyonUtils.ts
// (TCanyon / TTripLog / TNotification / TUser). Kept as a mobile copy for now
// because hoisting them to shared/ means re-pointing every frontend import;
// flagged in PROGRESS.md as a follow-up. If a field changes server-side,
// update BOTH this file and canyonUtils.ts.
import type { MediaItem, ThemeSchemeId, TripLogCustomFieldDef, NotificationPreferences } from "@logjam/shared";

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
  // Populated only by the OWNED list (GET /canyons) — absent on a canyon
  // shared WITH you by design, not zero (owner-private aggregate; see the
  // canyon-share visibility convention in root CLAUDE.md). Never coalesce a
  // missing count to 0 and present it as an answer about a shared canyon.
  _count?: { tripLogLinks: number; shares: number };
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
  media?: MediaItem[];
};

export type TNotification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};

export type TUser = {
  id: string;
  username: string;
  email: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  monthlyTileQuota: number;
  monthlyTileUsage: number;
  monthlyTileResetAt: string;
  consentedAt: string | null;
  consentVersion: string | null;
  uiPreferences?: {
    themeSchemeId?: ThemeSchemeId;
    tripLogCustomFields?: TripLogCustomFieldDef[];
    canyonCustomFields?: TripLogCustomFieldDef[];
    notifications?: NotificationPreferences;
    autoDownloadGeoPdfs?: boolean;
    importMergePolicy?: string;
  } | null;
};
