// Display formatters shared across screens. Not in `src/ui` — that is the
// component kit, and a string function is not a component.

/**
 * Bytes as a size a person can act on: GB with one decimal, whole MB, whole KB.
 *
 * Precision is deliberately coarse and drops as the number grows, because every
 * use of this is a "is it worth deleting / have I got room" decision. A tenth of
 * a GB matters for that; a tenth of a MB does not. Anything non-zero reads as at
 * least 1 KB rather than "0 KB", which looks like a failed measurement.
 */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} MB`;
  if (bytes <= 0) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * "How long will this take", in the words the download screen has always used.
 * Lives here because the GeoPDF import now quotes a duration too, and two
 * surfaces phrasing the same wait differently is how a user learns to distrust
 * both numbers.
 */
export function formatMinutes(seconds: number): string {
  if (seconds < 90) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min`;
}
