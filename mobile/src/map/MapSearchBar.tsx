// Place search on the map. Collapsed it's a circular button in the top-left
// corner; tapping expands it into a full-width search bar with the keyboard up.
// Behaviour mirrors the web MapSearchBox: 3-char minimum, 350 ms debounce,
// Nominatim via `geocode`, tap a result to recentre.
//
// PRIVACY: only the typed string leaves the app (see src/geocode.ts). Canyon
// names and coordinates are never sent here, and results are not persisted.
import { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { geocode, messageFromError, type GeocodeResult } from "@logjam/shared";

import { fontSize, fontWeight, hitSlop, radius, spacing, theme } from "../theme";
import { CHROME_GAP, FAB_ICON, FAB_SIZE } from "./mapChrome";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;

export function MapSearchBar({
  topInset,
  onSelectPlace,
}: {
  /** Status-bar inset — chrome must never sit under the camera cutout. */
  topInset: number;
  onSelectPlace: (latitude: number, longitude: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!expanded) return;
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      geocode(trimmed, controller.signal)
        .then((found) => {
          setResults(found);
          setError(null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error(err);
          setError(messageFromError(err, "Couldn't search for that place."));
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, expanded]);

  const collapse = () => {
    Keyboard.dismiss();
    setExpanded(false);
    setQuery("");
    setResults([]);
    setError(null);
    setLoading(false);
  };

  if (!expanded) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Search for a place"
        style={[styles.fab, { top: topInset + CHROME_GAP }]}
        onPress={() => setExpanded(true)}
      >
        <Feather name="search" size={FAB_ICON} color={theme.textPrimary} />
      </Pressable>
    );
  }

  const showPanel = loading || error !== null || results.length > 0;

  return (
    <View style={[styles.expanded, { top: topInset + CHROME_GAP }]}>
      <View style={styles.inputRow}>
        <Feather name="search" size={18} color={theme.textMuted} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a place…"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="Search for a place to centre the map"
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={query ? "Clear search" : "Close search"}
          hitSlop={hitSlop}
          onPress={() => (query ? setQuery("") : collapse())}
        >
          <Feather name="x" size={20} color={theme.textPrimary} />
        </Pressable>
      </View>

      {showPanel ? (
        <View style={styles.panel}>
          {loading ? <Text style={styles.status}>Searching…</Text> : null}
          {error !== null ? <Text style={styles.status}>{error}</Text> : null}
          {!loading && error === null ? (
            <ScrollView keyboardShouldPersistTaps="handled">
              {results.map((result, index) => (
                <Pressable
                  key={`${result.lat},${result.lon},${index}`}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.result,
                    pressed && styles.resultPressed,
                  ]}
                  onPress={() => {
                    onSelectPlace(result.lat, result.lon);
                    collapse();
                  }}
                >
                  <Text style={styles.resultText} numberOfLines={2}>
                    {result.displayName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    left: CHROME_GAP,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: theme.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  expanded: {
    position: "absolute",
    left: CHROME_GAP,
    right: CHROME_GAP,
    gap: spacing(1),
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: theme.secondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing(2),
    minHeight: 52,
  },
  input: {
    flex: 1,
    fontSize: fontSize.base,
    color: theme.textPrimary,
    paddingVertical: spacing(1.25),
  },
  panel: {
    backgroundColor: theme.secondary,
    borderRadius: radius.lg,
    overflow: "hidden",
    maxHeight: 260,
  },
  status: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
  },
  result: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.bonus2,
  },
  resultPressed: { backgroundColor: theme.bonus2 },
  resultText: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
  },
});
