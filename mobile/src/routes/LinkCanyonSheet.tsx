// Link a route to a canyon, from the phone.
//
// A canyon holds AT MOST ONE route, so linking to an occupied canyon displaces
// the incumbent. That is not destructive — the displaced route survives
// standalone — but it changes what everyone the canyon is shared with can see,
// so it is confirmed by name first. Same rule as the web panel; the rule itself
// lives server-side in api/src/lib/routeLink.ts and is not re-derived here.
//
// Reads canyons from the MIRROR, so this works with no signal: the link is an
// outbox op like any other edit.
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row, TextField } from "../ui";
import { updateRouteLocal } from "../sync/outbox";
import { useMirrorCanyons, useMirrorRoutes } from "../sync/useSyncQueries";
import type { MirrorRoute } from "../sync/mirrorStore";

/** Beyond this the list is a scroll-hunt; the filter is the way through. */
const VISIBLE_CANYONS = 40;

export function LinkCanyonSheet({
  route,
  visible,
  onClose,
  onInfo,
  onError,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const canyons = useMirrorCanyons();
  const routes = useMirrorRoutes();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  // Only canyons the user OWNS can take a link — the API refuses the rest, and
  // offering them would be a 404 waiting to happen.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (canyons.data ?? [])
      .filter((canyon) => canyon.syncRole !== "shared")
      .filter((canyon) => !needle || canyon.name.toLowerCase().includes(needle))
      .slice(0, VISIBLE_CANYONS);
  }, [canyons.data, query]);

  if (!route) return null;

  const linkedCanyon = (canyons.data ?? []).find((c) => c.id === route.canyonId);

  const write = (canyonId: string | null) => {
    setBusy(true);
    updateRouteLocal(route.id, { canyonId })
      .then(() => {
        onInfo(canyonId ? "Route linked." : "Route unlinked.");
        onClose();
      })
      .catch((err: unknown) => {
        console.error(err);
        onError(messageFromError(err, "Couldn't change the link."));
      })
      .finally(() => setBusy(false));
  };

  const pick = (canyonId: string, canyonName: string) => {
    const incumbent = (routes.data ?? []).find(
      (other) => other.canyonId === canyonId && other.id !== route.id,
    );
    if (!incumbent) {
      write(canyonId);
      return;
    }
    Alert.alert(
      `${canyonName} already has a route`,
      `“${incumbent.name}” will be unlinked and kept as a standalone route.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Replace", onPress: () => write(canyonId) },
      ],
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Link to a canyon">
      <View style={styles.body}>
        <Text style={styles.hint}>
          A linked route is part of that canyon&rsquo;s record — anyone you share
          the canyon with can see it.
        </Text>

        {linkedCanyon ? (
          <Row
            title={`Unlink from ${linkedCanyon.name}`}
            icon="link-2"
            hue={theme.warning}
            disabled={busy}
            onPress={() => write(null)}
          />
        ) : null}

        <TextField label="Find a canyon" value={query} onChangeText={setQuery} />

        {matches.length === 0 ? (
          <Text style={styles.hint}>
            {query ? "No canyon of yours matches that." : "You have no canyons yet."}
          </Text>
        ) : (
          matches.map((canyon) => (
            <Row
              key={canyon.id}
              title={canyon.name}
              icon={canyon.id === route.canyonId ? "check" : "map-pin"}
              hue={canyon.id === route.canyonId ? theme.accent : assetHue.route}
              disabled={busy || canyon.id === route.canyonId}
              onPress={() => pick(canyon.id, canyon.name)}
            />
          ))
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
