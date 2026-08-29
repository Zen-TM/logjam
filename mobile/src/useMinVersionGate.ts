import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { config, CLIENT_SEMVER, CLIENT_VERSION, CLIENT_VERSION_HEADER } from "./config";
import { meteredness, subscribeConnection } from "./offline/networkPolicy";
import { isVersionBelowMinimum, upgradeEnforcement, type UpgradeEnforcement } from "./version";

// Forced-upgrade gate (Stage 0 lever). Checked on app start; "unknown" (offline
// or endpoint unreachable) NEVER blocks — blocking an offline user mid-trip
// over an upgrade check would violate the offline-first semantics (see Stage 1
// session rules). Only a positive "server says this build is too old" blocks.
//
// MAPP-002: and even then, only on a connection the user can actually update
// over for free. This hook owns the EFFECTS (the fetch, the foreground
// re-check, the connection subscription); the decision itself is
// `upgradeEnforcement` in ./version, pure and exhaustively tested, because
// mobile/ has no React Native test environment and a rule inside a hook is a
// rule nothing can run.
export type MinVersionGate =
  | { status: "unknown" }
  | { status: "ok" }
  | { status: "upgradeRequired"; minVersion: string; enforcement: UpgradeEnforcement };

/** What the SERVER said, before the connection has a say (MAPP-002). */
type ServerAnswer =
  | { status: "unknown" }
  | { status: "ok" }
  | { status: "upgradeRequired"; minVersion: string };

export function useMinVersionGate(): MinVersionGate {
  const [gate, setGate] = useState<ServerAnswer>({ status: "unknown" });
  // Tri-state, and it starts at null on purpose: "the platform has not told us
  // yet" must warn, not block. See upgradeEnforcement.
  const [metered, setMetered] = useState<boolean | null>(null);
  const status = gate.status;

  // The check re-runs on foreground WHILE, AND ONLY WHILE, the answer is still
  // "unknown". A launch with no signal is the normal case at a trailhead, and a
  // single failed check used to pin the lever off for the whole process — the
  // build stayed unreachable even after the phone found a bar of reception. The
  // narrow condition is what keeps the offline-first promise: once a build has
  // been told "ok" it is never re-gated, so a session that started online can
  // never be blocked mid-trip; only one that never got an answer at all can
  // still receive one. "upgradeRequired" is terminal either way.
  useEffect(() => {
    if (status !== "unknown") return;
    let cancelled = false;
    const check = () => {
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
          // Setting it again is a no-op for this effect (it keys off the status
          // string, not the object), so this cannot loop.
          if (!cancelled) setGate({ status: "unknown" });
        });
    };
    check();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [status]);

  // Escalation, without asking the server anything twice: a user warned on
  // mobile data must become blocked once they reach an unmetered connection,
  // in the session they are already in. The min-version answer cannot change
  // under them — only the connection can — so this recomputes rather than
  // re-fetches. Subscribed only once the build IS below the minimum, which is
  // both terminal and rare; nobody else pays for the listener.
  useEffect(() => {
    if (status !== "upgradeRequired") return;
    return subscribeConnection((state) => setMetered(meteredness(state)));
  }, [status]);

  if (gate.status !== "upgradeRequired") return gate;
  return { ...gate, enforcement: upgradeEnforcement({ belowMinimum: true, metered }) };
}
