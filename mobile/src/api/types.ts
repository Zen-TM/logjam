// API response shapes consumed by Logjam GPS.
//
// The declarations live in `shared/src/apiTypes.ts` — one copy of the server
// contract for both clients (Logjam Web re-exports the same types from
// `frontend/src/placeUtils.ts`). This file is the Logjam GPS import path; add
// nothing to it but re-exports.
export type { TPlace, TNotification, TTripLog, TUser } from "@logjam/shared";
