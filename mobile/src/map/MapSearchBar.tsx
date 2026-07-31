// Place search on the map.
//
// It is ONE pill the whole time. Collapsed it is a circle exactly as tall as
// the expanded bar, with the search glyph at its centre; tapping it grows the
// circle rightwards into the full bar and the glyph never moves — the button
// becomes the field rather than being replaced by one. (The previous version
// swapped a 72pt round button for a full-width rounded rectangle, so the icon
// jumped left and up and the two shapes had nothing in common.)
//
// Behaviour mirrors the web MapSearchBox: 3-char minimum, 350 ms debounce,
// Nominatim via `geocode`, tap a result to recentre.
//
// PRIVACY: only the typed string leaves the app (see src/geocode.ts). Canyon
// names and coordinates are never sent here, and results are not persisted.
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { geocode, messageFromError, type GeocodeResult } from "@logjam/shared";

import { fontSize, fontWeight, hitSlop, radius, spacing, theme } from "../theme";
import { CHROME_GAP, SEARCH_SIZE } from "./mapChrome";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;
const GLYPH = 20;
/** Keeps the glyph on the circle's centre line at every width. */
const GLYPH_INSET = (SEARCH_SIZE - GLYPH) / 2;
const EXPAND_MS = 220;

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
  const { width: windowWidth } = useWindowDimensions();

  // One driver for width and for the fade of everything that only exists in
  // the expanded state. Width can't run on the native driver, so neither does
  // the opacity — keeping them on one value is what stops the text appearing
  // before there is room for it.
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, {
      toValue: expanded ? 1 : 0,
      duration: EXPAND_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, grow]);

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

  // Focus AFTER the expansion has committed, not from the tap handler: the
  // field is `editable={expanded}`, and a focus() that lands on the frame
  // where it is still false is silently dropped — the bar opened with no
  // keyboard and swallowed everything typed at it.
  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [expanded]);

  const collapse = () => {
    Keyboard.dismiss();
    setExpanded(false);
    setQuery("");
    setResults([]);
    setError(null);
    setLoading(false);
  };

  const width = grow.interpolate({
    inputRange: [0, 1],
    outputRange: [SEARCH_SIZE, windowWidth - CHROME_GAP * 2],
  });
  const showPanel = expanded && (loading || error !== null || results.length > 0);

  return (
    <View style={[styles.root, { top: topInset + CHROME_GAP }]} pointerEvents="box-none">
      <Animated.View style={[styles.pill, { width }]}>
        <Feather
          name="search"
          size={GLYPH}
          color={expanded ? theme.textMuted : theme.textPrimary}
          style={styles.glyph}
        />
        <Animated.View style={[styles.field, { opacity: grow }]}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search for a place…"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="Search for a place to centre the map"
            autoCorrect={false}
            returnKeyType="search"
            editable={expanded}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={query ? "Clear search" : "Close search"}
            hitSlop={hitSlop}
            onPress={() => (query ? setQuery("") : collapse())}
          >
            <Feather name="x" size={GLYPH} color={theme.textPrimary} />
          </Pressable>
        </Animated.View>
        {/* Collapsed, the whole circle is the button; expanded it must not
            steal taps from the field underneath it. */}
        {!expanded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search for a place"
            style={StyleSheet.absoluteFill}
            onPress={() => setExpanded(true)}
          />
        ) : null}
      </Animated.View>

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
  root: {
    position: "absolute",
    left: CHROME_GAP,
    right: CHROME_GAP,
    gap: spacing(1),
    alignItems: "flex-start",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    height: SEARCH_SIZE,
    borderRadius: SEARCH_SIZE / 2,
    backgroundColor: theme.secondary,
    // The field is clipped by the growing circle rather than spilling past it.
    overflow: "hidden",
  },
  glyph: { marginLeft: GLYPH_INSET },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingLeft: spacing(1.5),
    paddingRight: GLYPH_INSET,
  },
  input: {
    flex: 1,
    fontSize: fontSize.base,
    color: theme.textPrimary,
    paddingVertical: spacing(1),
  },
  panel: {
    alignSelf: "stretch",
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
