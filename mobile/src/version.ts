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

/** What a build below the minimum is allowed to do to the user (MAPP-002). */
export type UpgradeEnforcement = "none" | "warn" | "block";

/**
 * THE UPGRADE RULE, pure so it can be tested exhaustively (MAPP-002).
 *
 * The gate used to have one outcome — block the whole app — and it re-checks on
 * foreground after an offline start, so that block can now land on a user
 * standing in a canyon: a dead app holding their offline maps and their
 * in-progress track, whose only remedy is a Play Store they cannot reach.
 *
 * So the hard block is reserved for the one connection where the remedy is
 * actually to hand and free: a DEFINITELY UNMETERED one. Everything else warns
 * and keeps working. `metered` is deliberately tri-state — `null` ("the
 * platform did not say") must fail toward the warning, which the boolean
 * `isExpensive` could not express, because it collapses "unknown" into "not
 * expensive" and would have blocked exactly the user this rule protects.
 *
 * Note what is NOT an input: reachability. A build that never got an answer
 * from the server is not `belowMinimum` at all, and neither warns nor blocks.
 */
export function upgradeEnforcement(args: {
  belowMinimum: boolean;
  metered: boolean | null;
}): UpgradeEnforcement {
  if (!args.belowMinimum) return "none";
  return args.metered === false ? "block" : "warn";
}

/**
 * Where a blocked build sends the user for the update (MAPP-001), pure so the
 * branch that could actually be wrong can be run: iOS HAS a bundleIdentifier
 * but no App Store listing to point at, so it must degrade to the screen's text
 * alone rather than offer a button onto a page that does not exist.
 *
 * The https form and not `market://`, because it still resolves when the Play
 * app is missing — a sideloaded field build is exactly the case the block
 * screen exists for. The package id is passed in from app.json rather than
 * written here a second time, so it cannot drift from the id the store lists;
 * absent (or empty, which is the same thing) there is nothing to link to.
 */
export function storeListingUrl(args: {
  os: string;
  androidPackage: string | null | undefined;
}): string | null {
  if (args.os !== "android" || !args.androidPackage) return null;
  return `https://play.google.com/store/apps/details?id=${args.androidPackage}`;
}
