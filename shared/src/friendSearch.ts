// The pure parts of the friend picker: matching a typed query, and the
// initials/hue an avatar is drawn from.
//
// Shared, because both clients draw the same friend picker: Logjam GPS's share
// sheet and Logjam Web's ShareDialog filter the same list, and an avatar has to
// be the SAME colour and the same two letters on both, or a person changes
// identity when you pick up the other device. It lived in `mobile/src/sharing/`
// until Logjam Web's friends work (2026-09-18); it was already free of React
// Native imports, which is what made it testable there and movable here.

/** Case-insensitive substring match. An empty query matches everything. */
export function friendMatches(username: string, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  return trimmed.length === 0 || username.toLowerCase().includes(trimmed);
}

/**
 * One or two letters standing in for a face.
 *
 * A username with separators reads as parts ("jo_smith" → JS); one without is
 * simply its first two letters ("bmarshall" → BM), which is still a stable,
 * distinguishing mark and beats a generic person glyph repeated down the list.
 * Code points rather than chars, so a non-Latin username is not cut in half.
 */
export function avatarInitials(username: string): string {
  const parts = username.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length >= 2) {
    return (first(parts[0]) + first(parts[1])).toUpperCase();
  }
  return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
}

function first(part: string): string {
  return Array.from(part)[0] ?? "";
}

/**
 * Which palette slot an avatar takes, hashed from the NAME rather than from a
 * position in the list — DESIGN.md §3's open-vocabulary rule. An index would
 * repaint everyone the moment a new friend sorts ahead of them; a hash keeps a
 * person the same colour across sessions, screens and devices.
 */
export function avatarHueIndex(username: string, paletteSize: number): number {
  let hash = 0;
  for (let index = 0; index < username.length; index += 1) {
    hash = (hash * 31 + username.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % paletteSize;
}
