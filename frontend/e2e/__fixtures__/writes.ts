// What counts as a write for a spec that shares the seeded account with the
// suites after it: any request that is not a read. a11y.spec.ts and
// pseudo.spec.ts each fail on one, naming it.
import type { Request } from "@playwright/test";

// POSTs that only read: they carry a body too big or too long for a query
// string (presigned GET urls, elevations along a line, a job's price quote).
export const READ_ONLY_POSTS = [
  "/media/download-urls",
  "/elevation/point",
  "/elevation/profile",
  "/compute-estimate",
];

export const isWrite = (request: Request): boolean =>
  !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
  !READ_ONLY_POSTS.includes(new URL(request.url()).pathname);
