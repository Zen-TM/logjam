// Place search on the map.
//
// It is ONE pill the whole time. Collapsed it is a circle exactly as tall as
// the expanded bar, with the search glyph at its centre; tapping it grows the
// circle rightwards into the full bar and the glyph never moves — the button
// becomes the field rather than being replaced by one. Swapping a round button
// for a full-width rounded rectangle would make the icon jump left and up,
// disconnecting the two shapes.
//
// Locations come as the user types from the OpenStreetMap place registry
// (`placeSearch.ts`): the phone's own copy when it has one, or our API for a
// signed-in phone without it. Nominatim answers only when asked: the last row
// is "Search locations for …" (or the keyboard's Search key), as on Logjam
// Web, for the street addresses the registry leaves out. Its usage policy
// forbids search as you type, and a box that geocoded every keystroke would
// send every canyon name typed to a third party. Tap a result to recentre.
//
// IT SEARCHES THE USER'S OWN THINGS FIRST, and those never touch the network.
// A box that can find Katoomba but not the place you saved last week answers
// the question nobody has standing in the bush; saved matches are
// ranked on the device (`localSearch.ts`), appear from the second keystroke
// with no debounce and no request, and are listed ABOVE the places with their
// kind's glyph and hue so the two are never confused for each other.
//
// PRIVACY: only the typed string leaves Logjam GPS, to our API when the phone
// has no registry, to Nominatim when asked (shared/src/geocode.test.ts), and
// nowhere when it has. No saved place's name or coordinates is sent — the saved matches are the
// reason they do not have to be — and results are not persisted.
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
import {
  geocode,
  GEOCODE_MIN_QUERY_LENGTH,
  messageFromError,
  PLACE_REGISTRY_ATTRIBUTION,
  PLACE_SEARCH_MIN_QUERY_LENGTH,
  placeResultDetail,
  searchLocationsLabel,
  searchPlaces,
  type GeocodeResult,
  type PlaceIndex,
} from "@logjam/shared";

import {
  hitSlop,
  radius,
  spacing,
  makeStyles,
  useTheme,
  muted,
} from "../theme";
import { useAccountState } from "../auth/AccountStateContext";
import {
  loadPlaceIndex,
  placeIndex,
  usePlaceRegistryStatus,
} from "../offline/placeRegistry";
import { rankLocalMatches, type LocalSearchCandidate } from "./localSearch";
import {
  askPlacesOnline,
  MAX_PLACE_RESULTS,
  placesFromAnswer,
  placeSearchSource,
  searchRows,
  type PlaceAnswer,
} from "./placeSearch";
import { CHROME_GAP, SEARCH_SIZE } from "./mapChrome";
import type { Bbox } from "../saved/bboxOfPoints";
import { FieldError, Icon, type Glyph } from "../ui";

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
  icon: Glyph;
  hue: string;
  title: string;
  /** What kind of thing it is — "Place", "Waypoint". The row's only subtitle. */
  kindLabel: string;
  /** Matched but never displayed: alt names. */
  alternates?: readonly string[];
  resolveBbox: () => Promise<Bbox | null>;
};

export function MapSearchBar({
  topInset,
  side = "left",
  reservedWidth = 0,
  online,
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
  /** False offline and in offline-only mode: no API search then. */
  online: boolean;
  /** The user's own places, waypoints, tracks and route files. */
  savedItems: readonly SavedSearchItem[];
  onSelectPlace: (latitude: number, longitude: number) => void;
  onSelectSaved: (item: SavedSearchItem) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  // The query the user asked the geocoder about. Typing on past it leaves the
  // answer behind and offers the ask row again.
  const [asked, setAsked] = useState<string | null>(null);
  // Tagged with the query it answers, so a stale or still-pending answer reads
  // as "no answer" without being cleared from an effect.
  const [search, setSearch] = useState<{
    query: string;
    results: GeocodeResult[];
    error: string | null;
  } | null>(null);
  const trimmed = query.trim();
  const searchable = expanded && trimmed.length >= GEOCODE_MIN_QUERY_LENGTH;
  const askedHere = searchable && asked === trimmed;
  const answer = askedHere && search?.query === trimmed ? search : null;
  const loading = askedHere && answer === null;
  const results = answer?.results ?? [];
  const error = answer?.error ?? null;
  const inputRef = useRef<TextInput>(null);
  const { width: windowWidth } = useWindowDimensions();

  // ── The place registry, as the user types ───────────────────────────────
  const { accountState } = useAccountState();
  const registry = usePlaceRegistryStatus();
  const source = placeSearchSource(
    registry.stored !== null,
    accountState,
    online,
  );
  const [index, setIndex] = useState<PlaceIndex | null>(placeIndex);
  // Built on the first open, not with the map: nobody who never searches
  // carries it. The build takes a few seconds, in slices; until it is ready
  // the user's own matches show and a loading row stands for the rest.
  useEffect(() => {
    if (!expanded || registry.stored === null) return;
    let live = true;
    void loadPlaceIndex().then((loaded) => {
      if (live) setIndex(loaded);
    });
    return () => {
      live = false;
    };
  }, [expanded, registry.stored]);
  const placeQuery =
    expanded && trimmed.length >= PLACE_SEARCH_MIN_QUERY_LENGTH;
  const devicePlaces = useMemo(
    () =>
      source === "device" && index && placeQuery
        ? searchPlaces(index, trimmed, MAX_PLACE_RESULTS)
        : [],
    [source, index, placeQuery, trimmed],
  );
  // The last answer stays up while the query only grows, so the list does not
  // blink on every keystroke.
  const [placeAnswer, setPlaceAnswer] = useState<PlaceAnswer | null>(null);
  useEffect(() => {
    if (source !== "api" || !placeQuery) return;
    return askPlacesOnline(trimmed, setPlaceAnswer);
  }, [source, placeQuery, trimmed]);
  const places =
    source === "device"
      ? index || !placeQuery
        ? devicePlaces
        : "loading"
      : source === "api" && placeQuery
        ? placesFromAnswer(placeAnswer, trimmed)
        : [];

  // One driver for width and for the fade of everything that only exists in
  // the expanded state. Width can't run on the native driver, so neither does
  // the opacity — keeping them on one value is what stops the text appearing
  // before there is room for it.
  const [grow] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(grow, {
      toValue: expanded ? 1 : 0,
      duration: EXPAND_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [expanded, grow]);

  useEffect(() => {
    if (asked === null) return;
    const controller = new AbortController();
    geocode(asked, controller.signal)
      .then((found) => {
        setSearch({ query: asked, results: found, error: null });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setSearch({
          query: asked,
          results: [],
          error: messageFromError(err, "Couldn't search for that place."),
        });
      });
    return () => controller.abort();
  }, [asked]);

  const ask = () => {
    if (searchable) setAsked(trimmed);
  };

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
    setAsked(null);
    setSearch(null);
    setPlaceAnswer(null);
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
  const offerAsk = searchable && !askedHere;
  // Yours first, and above the network's answer whatever state that is in: a
  // saved match is already correct while the geocoder is still being waited
  // on, and with no signal it is the only answer there will ever be.
  const rows = searchRows(localMatches, places, offerAsk);
  const showPanel =
    expanded &&
    (rows.length > 0 || loading || error !== null || results.length > 0);

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
        <Icon
          idea="search"
          size={GLYPH}
          color={expanded ? theme.textMuted : theme.text}
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
            onSubmitEditing={ask}
            editable={expanded}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={query ? "Clear search" : "Close search"}
            hitSlop={hitSlop}
            onPress={() => (query ? setQuery("") : collapse())}
          >
            <Icon idea="close" size={GLYPH} color={theme.text} />
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
            {rows.map((row) => {
              switch (row.kind) {
                case "saved": {
                  const item = row.item;
                  return (
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
                      <Icon idea={item.icon} size={16} color={item.hue} />
                      <View style={styles.savedText}>
                        <Text style={styles.resultText} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.resultKind}>{item.kindLabel}</Text>
                      </View>
                    </Pressable>
                  );
                }
                case "place": {
                  const { place } = row;
                  const what = placeResultDetail(place);
                  return (
                    <Pressable
                      key={`${place.lat},${place.lon},${place.name}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${place.name}, ${what}`}
                      style={({ pressed }) => [
                        styles.result,
                        pressed && styles.resultPressed,
                      ]}
                      onPress={() => {
                        onSelectPlace(place.lat, place.lon);
                        collapse();
                      }}
                    >
                      <Text style={styles.resultText} numberOfLines={2}>
                        {place.name}
                      </Text>
                      <Text style={styles.resultKind}>{what}</Text>
                    </Pressable>
                  );
                }
                case "error":
                  return (
                    <View key="error" style={styles.statusBox}>
                      <FieldError message={row.message} />
                    </View>
                  );
                case "loading":
                  return (
                    <Text key="loading" style={styles.status}>
                      Loading place names…
                    </Text>
                  );
                case "credit":
                  return (
                    <Text key="credit" style={styles.credit}>
                      {PLACE_REGISTRY_ATTRIBUTION}
                    </Text>
                  );
                case "ask":
                  return (
                    <Pressable
                      key="ask"
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.result,
                        styles.savedResult,
                        pressed && styles.resultPressed,
                      ]}
                      onPress={ask}
                    >
                      <Icon idea="search" size={16} color={theme.textMuted} />
                      <Text style={[styles.resultText, styles.savedText]}>
                        {searchLocationsLabel(trimmed)}
                      </Text>
                    </Pressable>
                  );
              }
            })}
            {loading ? <Text style={styles.status}>Searching…</Text> : null}
            {error !== null ? (
              <View style={styles.statusBox}>
                <FieldError message={error} />
              </View>
            ) : null}
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

const useStyles = makeStyles((theme, textRole) => ({
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
    backgroundColor: theme.card,
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
    ...textRole.body,
    flex: 1,
    color: theme.text,
    paddingVertical: spacing(1),
  },
  panel: {
    alignSelf: "stretch",
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    overflow: "hidden",
    maxHeight: 260,
  },
  statusBox: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
  },
  status: {
    ...muted(theme, textRole.detail),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
  },
  result: {
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  resultPressed: { backgroundColor: theme.cardPressed },
  savedResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
  },
  savedText: { flex: 1 },
  resultKind: { ...muted(theme, textRole.meta) },
  credit: {
    ...muted(theme, textRole.meta),
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  resultText: { ...textRole.detail, color: theme.text },
}));
