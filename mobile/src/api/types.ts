// API response shapes consumed by the mobile client.
//
// The declarations live in `shared/src/apiTypes.ts` — one copy of the server
// contract for both clients (the web client re-exports the same types from
// `frontend/src/canyonUtils.ts`). This file stays as the mobile import path so
// no call site had to move; add nothing to it but re-exports.
export type {
  TCanyon,
  TCanyonAttributes,
  TNotification,
  TTripLog,
  TUser,
} from "@logjam/shared";
