// The API signs a LiDAR ZIP's parts (api/src/lib/topoUpload.ts) and Logjam
// Web asks for them (frontend/src/components/dialogs/topoUpload.ts); one
// declaration each, so neither side's number can drift from the other's.

/** Part URLs one request may ask the API to sign. */
export const TOPO_UPLOAD_SIGN_MAX = 32;

/** How long a signed part URL lasts. */
export const TOPO_UPLOAD_PART_URL_TTL_SECONDS = 15 * 60;
