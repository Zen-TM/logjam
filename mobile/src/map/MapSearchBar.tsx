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
// IT SEARCHES THE USER'S OWN THINGS FIRST, and those never touch the network.
// A box that could find Katoomba but not the canyon you saved last week was
// answering the question nobody has standing in the bush; saved matches are
// ranked on the device (`localSearch.ts`), appear from the second keystroke
// with no debounce and no request, and are listed ABOVE the places with their
// kind's glyph and hue so the two are never confused for each other.
//
// PRIVACY: only the typed string leaves the app (see src/geocode.ts). Canyon
// names and coordinates are never sent here — the saved matches are the reason
// they do not have to be — and results are not persisted.
import { useEffect, useMemo, useRef, useState } from "react";
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
import { rankLocalMatches, type LocalSearchCandidate } from "./localSearch";
import { CHROME_GAP, SEARCH_SIZE } from "./mapChrome";
import type { Bbox } from "../saved/bboxOfPoints";

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 3;
const GLYPH = 20;
/** Keeps the glyph on the circle's centre line at every width. */
const GLYPH_INSET = (SEARCH_SIZE - GLYPH) / 2;
const EXPAND_MS = 220;
/** Saved matches shown at once. Past this the panel is a list to read rather
 *  than a shortcut, and the place results below it stop being reachable. */
const MAX_LOCAL_RESULTS = 6;

/**
 * One of the user's own saved things, as the search box sees it.
 *
 * Composed by `MapScreen`, which already holds every one of these lists. The
 * extent is resolved LAZILY (`resolveBbox`, the same descriptor Saved uses):
 * a track's bounds mean reading its points off disk, and doing that for every
 * candidate on every keystroke would be a file read per row per letter.
 */
export type SavedSearchItem = {
  key: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
  title: string;
  /** What kind of thing it is — "Canyon", "Waypoint". The row's only subtitle. */
  kindLabel: string;
  /** Matched but never displayed: alt names, tags. */
  alternates?: readonly string[];
  resolveBbox: () => Promise<Bbox | null>;
};

export function MapSearchBar({
  topInset,
  side = "left",
  reservedWidth = 0,
  savedItems,
  onSelectPlace,
  onSelectSaved,
}: {
  /** Status-bar inset — chrome must never sit under the camera cutout. */
  topInset: number;
  /**
   * Which top corner it collapses into — the one the action column is NOT on
   * (Settings → Map). Search and the record button are a pair at the two ends
   * of the top edge, and the pair has to flip with the user's handedness or
   * the two related controls end up at opposite corners.
   */
  side?: "left" | "right";
  /**
   * Width to leave free at the other end when expanded — the record button and
   * its gap. Without it the bar grows straight over the top of a control that
   * has to stay reachable while a recording runs.
   */
  reservedWidth?: number;
  /** The user's own canyons, waypoints, tracks and route files. */
  savedItems: readonly SavedSearchItem[];
  onSelectPlace: (latitude: number, longitude: number) => void;
  onSelectSaved: (item: SavedSearchItem) => void;
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

  // NOT debounced and not memoised on the query: it is a substring scan over
  // one person's saved rows, and it has to answer on the keystroke — the whole
  // point of the local half is that it costs nothing to run.
  const candidates: LocalSearchCandidate<SavedSearchItem>[] = useMemo(
    () =>
      savedItems.map((item) => ({
        title: item.title,
        alternates: item.alternates,
        value: item,
      })),
    [savedItems],
  );
  const localMatches = expanded
    ? rankLocalMatches(query, candidates, MAX_LOCAL_RESULTS).map((m) => m.value)
    : [];

  const width = grow.interpolate({
    inputRange: [0, 1],
    outputRange: [SEARCH_SIZE, windowWidth - CHROME_GAP * 2 - reservedWidth],
  });
  const showPanel =
    expanded &&
    (loading || error !== null || results.length > 0 || localMatches.length > 0);

  return (
    <View
      style={[
        styles.root,
        { top: topInset + CHROME_GAP },
        side === "right" && styles.rootRight,
      ]}
      pointerEvents="box-none"
    >
      {/* Mirrored on the right: the pill grows out of the corner it sits in,
          so the glyph has to be anchored to the edge that does NOT move. Laid
          out left-to-right on the right side, the growing left edge drags the
          glyph across the screen and the expansion stops reading as one shape
          growing. */}
      <Animated.View
        style={[styles.pill, side === "right" && styles.pillRight, { width }]}
      >
        <Feather
          name="search"
          size={GLYPH}
          color={expanded ? theme.textMuted : theme.textPrimary}
          style={side === "right" ? styles.glyphRight : styles.glyph}
        />
        <Animated.View
          style={[
            styles.field,
            side === "right" && styles.fieldRight,
            { opacity: grow },
          ]}
        >
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
          <ScrollView keyboardShouldPersistTaps="handled">
            {/* Yours first, and above the network's answer whatever state that
                is in — a saved match is already correct while the geocoder is
                still being waited on, and with no signal it is the only answer
                there will ever be. */}
            {localMatches.map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, ${item.kindLabel}`}
                style={({ pressed }) => [
                  styles.result,
                  styles.savedResult,
                  pressed && styles.resultPressed,
                ]}
                onPress={() => {
                  onSelectSaved(item);
                  collapse();
                }}
              >
                <Feather name={item.icon} size={16} color={item.hue} />
                <View style={styles.savedText}>
                  <Text style={styles.resultText} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.resultKind}>{item.kindLabel}</Text>
                </View>
              </Pressable>
            ))}

            {loading ? <Text style={styles.status}>Searching…</Text> : null}
            {error !== null ? <Text style={styles.status}>{error}</Text> : null}
            {!loading && error === null
              ? results.map((result, index) => (
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
                ))
              : null}
          </ScrollView>
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
  // Collapsed, the circle sits in the right corner and the bar grows leftward
  // out of it — the glyph stays put either way, which is what makes the
  // expansion read as one shape growing rather than a swap.
  rootRight: { alignItems: "flex-end" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    height: SEARCH_SIZE,
    borderRadius: SEARCH_SIZE / 2,
    backgroundColor: theme.secondary,
    // The field is clipped by the growing circle rather than spilling past it.
    overflow: "hidden",
  },
  pillRight: { flexDirection: "row-reverse" },
  glyph: { marginLeft: GLYPH_INSET },
  glyphRight: { marginRight: GLYPH_INSET },
  field: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingLeft: spacing(1.5),
    paddingRight: GLYPH_INSET,
  },
  fieldRight: {
    flexDirection: "row-reverse",
    paddingLeft: GLYPH_INSET,
    paddingRight: spacing(1.5),
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
  savedResult: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  savedText: { flex: 1 },
  resultKind: { color: theme.textMuted, fontSize: fontSize.xs },
  resultText: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
  },
});
