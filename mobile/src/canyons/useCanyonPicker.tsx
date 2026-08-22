// "Which canyon?" — ONE panel, for every kind that can fill a canyon's route
// slot from its own options sheet: a route you drew, a recorded track, an
// imported file.
//
// It was `routes/LinkCanyonSheet`, a sheet of its own that the route's options
// sheet closed itself to open. Two more kinds wanted the same list, and three
// near-copies of a canyon picker is how one of them ends up with a different
// filter or a different warning. It returns `{ header, body }` — the shape
// `useSharePanel` established — so the sheet that owns the verb renders it as a
// SUB-MODE and never stacks a second sheet (DESIGN.md §6).
//
// Reads canyons from the MIRROR, so it works with no signal: the link is an
// outbox op like any other edit. Only canyons the user OWNS are offered — the
// API refuses the rest, and offering them is a 404 waiting to happen.
//
// What varies by kind is only the promise sentence and what `attach` does; the
// displacement decision is `routeSlot.ts`'s and nobody else's.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { TRACK_MIME_TYPES, messageFromError } from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { Row, TextField } from "../ui";
import { fillRouteSlot } from "./fillRouteSlot";
import {
  IMPORT_TO_CANYON_PROMISE,
  TRACK_TO_ROUTE_PROMISE,
  routeSlotOccupant,
  type WaySource,
} from "./routeSlot";
import {
  useMirrorCanyonTracks,
  useMirrorCanyons,
  useMirrorRoutes,
} from "../sync/useSyncQueries";

/** Beyond this the list is a scroll-hunt; the filter is the way through. */
const VISIBLE_CANYONS = 40;

/** Said where the user is about to act, not argued at each call site. */
const PROMISE: Partial<Record<WaySource, string>> = {
  track: TRACK_TO_ROUTE_PROMISE,
  import: IMPORT_TO_CANYON_PROMISE,
};

export function useCanyonPicker({
  source,
  active,
  currentCanyonId = null,
  ignoreRouteId = null,
  onUnlink,
  attach,
  onDone,
  onError,
}: {
  /** Which kind is being attached — picks the promise and the write order. */
  source: Extract<WaySource, "route" | "track" | "import">;
  /** Whether the sub-mode is open; a closed picker forgets its search. */
  active: boolean;
  /** The canyon this asset already fills, when it can fill one (a route). */
  currentCanyonId?: string | null;
  /** The route being MOVED, so it is not treated as its own incumbent. */
  ignoreRouteId?: string | null;
  /** Offered as the first row when the asset is already linked somewhere. */
  onUnlink?: () => Promise<unknown>;
  /** Write the new way into this canyon. The caller says what happened. */
  attach: (canyonId: string, canyonName: string) => Promise<unknown>;
  /** Filled — leave the sub-mode. */
  onDone: () => void;
  onError: (message: string) => void;
}): { header: ReactNode; body: ReactNode } {
  const canyons = useMirrorCanyons();
  const routes = useMirrorRoutes();
  const attachments = useMirrorCanyonTracks(TRACK_MIME_TYPES);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // A closed picker forgets its search: reopening on the next item must not
  // land on a list narrowed by what the last one was looking for.
  useEffect(() => {
    if (!active) setQuery("");
  }, [active]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (canyons.data ?? [])
      .filter((canyon) => canyon.syncRole !== "shared")
      .filter((canyon) => !needle || canyon.name.toLowerCase().includes(needle))
      .slice(0, VISIBLE_CANYONS);
  }, [canyons.data, query]);

  const linkedCanyon = (canyons.data ?? []).find(
    (canyon) => canyon.id === currentCanyonId,
  );

  const run = (job: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    job()
      .catch((err: unknown) => {
        console.error(err);
        onError(messageFromError(err, failure));
      })
      .finally(() => setBusy(false));
  };

  const pick = (canyonId: string, canyonName: string) => {
    const occupant = routeSlotOccupant(
      canyonId,
      routes.data ?? [],
      attachments.data ?? [],
      ignoreRouteId,
    );
    run(
      () =>
        fillRouteSlot({
          canyonName,
          source,
          occupant,
          write: () => attach(canyonId, canyonName),
        }).then((filled) => {
          if (filled) onDone();
        }),
      "Couldn't attach that to the canyon.",
    );
  };

  const promise = PROMISE[source];

  return {
    // Pinned: the field that narrows the list must not scroll away with it.
    header: (
      <View style={styles.header}>
        {promise ? <Text style={styles.hint}>{promise}</Text> : null}
        <Text style={styles.hint}>
          Anyone you share a canyon with can see linked routes.
        </Text>
        <TextField label="Find a canyon" value={query} onChangeText={setQuery} />
      </View>
    ),
    body: (
      <View style={styles.body}>
        {linkedCanyon && onUnlink ? (
          <Row
            title={`Unlink from ${linkedCanyon.name}`}
            icon="link-2"
            hue={theme.warning}
            disabled={busy}
            onPress={() =>
              run(
                () => onUnlink().then(onDone),
                "Couldn't change the link.",
              )
            }
          />
        ) : null}

        {matches.length === 0 ? (
          <Text style={styles.hint}>
            {query ? "No canyon of yours matches that." : "You have no canyons yet."}
          </Text>
        ) : (
          matches.map((canyon) => {
            const here = canyon.id === currentCanyonId;
            const occupied =
              !here &&
              routeSlotOccupant(
                canyon.id,
                routes.data ?? [],
                attachments.data ?? [],
                ignoreRouteId,
              ) !== null;
            return (
              <Row
                key={canyon.id}
                title={canyon.name}
                // State, not a warning: what displacing it costs is the
                // confirm's job, and saying it twice makes the row taller for
                // no new information.
                subtitle={
                  here
                    ? "Already this canyon's route"
                    : occupied
                      ? "Has a route already"
                      : undefined
                }
                icon={here ? "check" : "map-pin"}
                hue={here ? theme.accent : assetHue.route}
                disabled={busy || here}
                onPress={() => pick(canyon.id, canyon.name)}
              />
            );
          })
        )}
      </View>
    ),
  };
}

const styles = StyleSheet.create({
  header: { gap: spacing(1) },
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
