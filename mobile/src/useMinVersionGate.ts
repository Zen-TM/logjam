import { useEffect, useState } from "react";

import { config, CLIENT_SEMVER, CLIENT_VERSION, CLIENT_VERSION_HEADER } from "./config";
import { isVersionBelowMinimum } from "./version";

// Forced-upgrade gate (Stage 0 lever). Checked on app start; "unknown" (offline
// or endpoint unreachable) NEVER blocks — blocking an offline user mid-trip
// over an upgrade check would violate the offline-first semantics (see Stage 1
// session rules). Only a positive "server says this build is too old" blocks.
export type MinVersionGate =
  | { status: "unknown" }
  | { status: "ok" }
  | { status: "upgradeRequired"; minVersion: string };

export function useMinVersionGate(): MinVersionGate {
  const [gate, setGate] = useState<MinVersionGate>({ status: "unknown" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${config.apiUrl}/meta/min-mobile-version`, {
      headers: { [CLIENT_VERSION_HEADER]: CLIENT_VERSION },
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body: unknown = await response.json();
        const minVersion = (body as { minVersion?: unknown }).minVersion;
        if (typeof minVersion !== "string") {
          throw new Error("Malformed min-mobile-version response");
        }
        if (cancelled) return;
        setGate(
          isVersionBelowMinimum(CLIENT_SEMVER, minVersion)
            ? { status: "upgradeRequired", minVersion }
            : { status: "ok" }
        );
      })
      .catch(() => {
        // Unreachable/malformed = unknown, never a block. Deliberate silent
        // catch: the shell's API probe already surfaces connectivity loudly.
        if (!cancelled) setGate({ status: "unknown" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return gate;
}
