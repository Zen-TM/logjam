// Forced-upgrade check against GET /meta/min-mobile-version (Stage 0 lever;
// becomes load-bearing at Stage 8 when stale clients must be blockable).

/** Parse a bare "major.minor.patch" semver. Throws on anything else — a
 * malformed server value must fail loudly, not silently disable the lever. */
export function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionBelowMinimum(current: string, minimum: string): boolean {
  const currentParts = parseSemver(current);
  const minimumParts = parseSemver(minimum);
  for (let i = 0; i < 3; i++) {
    if (currentParts[i] !== minimumParts[i]) {
      return currentParts[i] < minimumParts[i];
    }
  }
  return false;
}
