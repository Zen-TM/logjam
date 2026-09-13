// Logbook stats — the retrospective half of the Logs tab.
//
// THE ONE QUESTION (DESIGN.md §1): "am I getting out, and is it going
// anywhere?" Logs itself already answers "what have I done?" with a count, a
// spark and the list, so this screen must not lead with a trip count — it leads
// with DAYS OUT, which is the number the list cannot give you, and the sections
// under it are all about frequency, progression and ground covered.
//
// ONE COMPONENT, TWO SCOPES. `activity` null is the All screen; an activity tag
// (or `UNTAGGED_ACTIVITY`) is the drill-down. They share the hero, the range
// rail, the spark and the cadence line — a second screen would have duplicated
// all four and then drifted. What differs is what hangs underneath: All lists
// the activities and the ground covered, a drill-down opens up the attributes.
//
// EVERY NUMBER IS LOCAL. The mirror holds the trips, the places, the
// definitions and the tracks, so this screen works with no signal, on a guest
// account, in a canyon — and needs no endpoint. `computeLogbookStats` is shared
// with the API so a phone and a browser cannot disagree about a total.
//
// PRIVACY: place names appear ("most returned to", the best-of attributions) —
// the user's own data, on their own device, which the Logs list beside it
// already shows. Nothing is logged, and there is deliberately NO share or
// export affordance: a stats card is exactly the kind of thing that would
// broaden visibility by default.
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  computeLogbookStats,
  formatDistanceM,
  formatDurationMs,
  UNTAGGED_ACTIVITY,
  type FieldStat,
  type LogbookStats,
} from "@logjam/shared";

import { useFieldDefs } from "../customFields/useFieldDefs";
import { readPref, writePref } from "../prefsDb";
import {
  useMirrorPlaces,
  useMirrorPlaceTypes,
  useMirrorTrips,
} from "../sync/useSyncQueries";
import { useTracks } from "../tracks/useTracks";
import { fontSize, fontWeight, spacing, theme, withAlpha } from "../theme";
import {
  ActivitySpark,
  Card,
  Chip,
  EmptyState,
  HeroHeader,
  Row,
  ScreenScroll,
  SectionHeader,
  StatGrid,
  type ActivityBucket,
  type Stat,
} from "../ui";
import {
  formatDateKey,
  logbookRanges,
  monthBucketsForYear,
  tripYear,
  yearBuckets,
  type LogbookRange,
} from "./logbook";
import { tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";

/** The label a tag-less trip is filed under, everywhere on this screen. */
const UNTAGGED_LABEL = "Untagged";

const RANGE_PREF_KEY = "logbookStatsRange";

function activityLabel(type: string): string {
  return type === UNTAGGED_ACTIVITY ? UNTAGGED_LABEL : tripTypeLabel(type);
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A rounded number for a stat tile — a mean of 4.333 is noise at two decimals
 *  and a lie at zero, so ratings keep one place and counts keep none. */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export function StatsScreen({
  activity = null,
  onBack,
  onOpenActivity,
}: {
  activity?: string | null;
  onBack: () => void;
  onOpenActivity: (activity: string) => void;
}) {
  const tripsQuery = useMirrorTrips();
  const placesQuery = useMirrorPlaces();
  const placeTypesQuery = useMirrorPlaceTypes();
  const { defs: tripDefs } = useFieldDefs("tripLog");
  const { defs: placeDefs } = useFieldDefs("place");
  const { tracks } = useTracks();

  const trips = useMemo(() => tripsQuery.data ?? [], [tripsQuery.data]);
  const places = useMemo(() => placesQuery.data ?? [], [placesQuery.data]);
  const placeTypes = useMemo(
    () => placeTypesQuery.data ?? [],
    [placeTypesQuery.data],
  );

  // The rail is derived from the data: one pill per season the user actually
  // has, which is what makes a scrolling rail earn its scroll.
  const ranges = useMemo(
    () => logbookRanges(trips.map((trip) => tripYear(trip.date))),
    [trips],
  );
  // Remembered per install rather than per screen: a drill-down is a pushed
  // screen with its own state, and having it silently reset the window the
  // numbers are read in would make the two screens disagree on screen.
  const [rangeLabel, setRangeLabelState] = useState(
    () => readPref(RANGE_PREF_KEY) ?? ranges[0].label,
  );
  const setRangeLabel = useCallback((label: string) => {
    setRangeLabelState(label);
    writePref(RANGE_PREF_KEY, label);
  }, []);
  const range: LogbookRange =
    ranges.find((entry) => entry.label === rangeLabel) ?? ranges[0];

  // OWN PLACES ONLY. A place shared with this account is someone else's ground;
  // counting it would inflate "places visited" and the completion meter with
  // rows the user never chose to keep.
  const ownPlaces = useMemo(
    () => places.filter((place) => place.syncRole !== "shared"),
    [places],
  );

  const stats = useMemo(
    () =>
      computeLogbookStats({
        trips: trips.map((trip) => ({
          id: trip.id,
          date: trip.date,
          types: trip.types,
          places: trip.places,
          customFields: trip.customFields,
        })),
        places: ownPlaces.map((place) => ({
          id: place.id,
          name: place.name,
          placeTypeId: place.placeTypeId,
          fieldValues: place.fieldValues,
        })),
        tripDefs,
        placeDefs,
        placeTypes: placeTypes.map((type) => ({
          id: type.id,
          name: type.name,
          color: type.color,
        })),
        from: range.from,
        to: range.to,
        activity,
      }),
    [trips, ownPlaces, tripDefs, placeDefs, placeTypes, range, activity],
  );

  // `data == null` rather than `loading`: that flag is false once the FIRST
  // sync of the process has happened, so a screen pushed later renders with no
  // rows for a frame — long enough to flash "nothing logged in here yet" over a
  // logbook with 123 trips in it, which is what the drill-down did.
  const reading = tripsQuery.data == null || placesQuery.data == null;

  const title = activity ? activityLabel(activity) : `${plural(stats.days, "day")} out`;

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow={activity ? "Logbook stats" : "Logbook"}
        title={title}
        titleNumberOfLines={2}
        onBack={onBack}
      >
        {/* The rail is part of the hero rather than the scroll: it is the frame
            every number below is read in, and a window control that scrolls
            away leaves the reader unsure what they are looking at. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {ranges.map((entry) => (
            <Chip
              key={entry.label}
              label={entry.label}
              active={entry.label === range.label}
              onPress={() => setRangeLabel(entry.label)}
            />
          ))}
        </ScrollView>
      </HeroHeader>

      {stats.trips === 0 ? (
        <EmptyState
          title={reading ? "Reading your logbook…" : "Nothing logged in here yet"}
          hint={
            reading
              ? undefined
              : activity
                ? `No ${activityLabel(activity).toLowerCase()} trips in this window. Try a wider one.`
                : "Log a few trips and this fills in — days out, how often you get away, and how far you've got through your places."
          }
        />
      ) : (
        <ScreenScroll>
          <Spark stats={stats} range={range} activity={activity} />
          <Headline
            stats={stats}
            activity={activity}
            bounded={range.from != null || range.to != null}
          />
          {activity ? (
            <AttributeSections stats={stats} />
          ) : (
            <>
              <Activities stats={stats} onOpenActivity={onOpenActivity} />
              <PlacesVisited stats={stats} />
              <OnFoot tracks={tracks} range={range} />
              <AttributeSections stats={stats} tripOnly />
            </>
          )}
        </ScreenScroll>
      )}
    </View>
  );
}

// ── Blocks ─────────────────────────────────────────────────────────────

/**
 * Months or years, decided by what the range actually spans.
 *
 * All time over more than one year is a YEAR axis — twelve months of a
 * four-year history is a window onto the wrong thing — while a single year pill
 * gets that year's twelve months rather than "the twelve ending now", which for
 * a past season would be twelve empty bars.
 */
function Spark({
  stats,
  range,
  activity,
}: {
  stats: LogbookStats;
  range: LogbookRange;
  activity: string | null;
}) {
  const explicitYear =
    /^\d{4}$/.test(range.label) ? Number(range.label) : null;
  const buckets: ActivityBucket[] =
    explicitYear != null
      ? monthBucketsForYear(stats.monthly, explicitYear)
      : stats.yearly.length > 1
        ? yearBuckets(stats.yearly)
        : monthBucketsForYear(
            stats.monthly,
            stats.yearly[0]?.year ?? new Date().getFullYear(),
          );

  const busiest = stats.monthly.reduce(
    (top, entry) => (entry.count > (top?.count ?? 0) ? entry : top),
    null as { year: number; month: number; count: number } | null,
  );
  const busiestLabel = busiest
    ? `busiest ${new Date(Date.UTC(busiest.year, busiest.month, 1)).toLocaleDateString(
        undefined,
        { month: "short", year: "numeric", timeZone: "UTC" },
      )} · ${plural(busiest.count, "trip")}`
    : undefined;

  // The cadence facts ride in the SAME caption block as the spark's own line:
  // they are the day-level reading of the shape directly above them, and a card
  // around them made three muted sentences look like a fourth statistic.
  const lines: string[] = [];
  if (!activity && stats.firstDate) {
    lines.push(`first trip ${formatDateKey(`${stats.firstDate}T00:00:00.000Z`)}`);
  }
  if (stats.averageGapDays != null && stats.longestGapDays != null) {
    lines.push(
      `every ${plural(stats.averageGapDays, "day")} on average · longest gap ${stats.longestGapDays}`,
    );
  }
  lines.push(
    `${stats.weekendTrips} of ${plural(stats.trips, "trip")} fell on a weekend`,
  );
  if (stats.longestRunDays > 1) {
    lines.push(`longest run ${plural(stats.longestRunDays, "day")} back to back`);
  }

  return (
    <View style={styles.block}>
      <ActivitySpark buckets={buckets} caption={busiestLabel} />
      {lines.map((line) => (
        <Text key={line} style={styles.caption}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function Headline({
  stats,
  activity,
  bounded,
}: {
  stats: LogbookStats;
  activity: string | null;
  /** True when a range pill narrower than "All time" is selected. */
  bounded: boolean;
}) {
  // EVERY LABEL SAYS WHAT IT COUNTS. "Places" could as easily have meant the
  // size of the library, and "Activities" read as a synonym for trips — both
  // were ambiguous on the first device run, and a stat tile has no room to
  // explain itself, so the label has to do it.
  //
  // Over ALL TIME every place was new ground once, so that tile would just
  // restate "Places visited" beside it. "Revisited" — places gone back to — is
  // the half of the pair that still says something on an unbounded window.
  const ground: Stat = bounded
    ? { label: "New places", value: `${stats.newPlaces}` }
    : { label: "Revisited", value: `${stats.repeatPlaces}` };
  const tiles: Stat[] = activity
    ? [
        { label: "Trips", value: `${stats.trips}` },
        { label: "Days out", value: `${stats.days}` },
        { label: "Places visited", value: `${stats.places}` },
        ground,
      ]
    : [
        { label: "Trips", value: `${stats.trips}` },
        { label: "Places visited", value: `${stats.places}` },
        { label: "Activity types", value: `${stats.activities}` },
        ground,
      ];
  return (
    <View style={styles.block}>
      <StatGrid stats={tiles} />
    </View>
  );
}

function Activities({
  stats,
  onOpenActivity,
}: {
  stats: LogbookStats;
  onOpenActivity: (activity: string) => void;
}) {
  if (stats.activityTallies.length === 0) return null;
  const multiTagged = stats.activityTallies.reduce(
    (sum, tally) => sum + tally.trips,
    0,
  ) > stats.trips;
  return (
    <View style={styles.section}>
      <SectionHeader label="By activity" />
      {stats.activityTallies.map((tally) => {
        const meta = tripTypeMeta(
          tally.type === UNTAGGED_ACTIVITY ? null : tally.type,
        );
        return (
          <Row
            key={tally.type}
            icon={meta.icon}
            hue={meta.hue}
            title={activityLabel(tally.type)}
            subtitle={
              tally.places > 0
                ? `${plural(tally.trips, "trip")} · ${plural(tally.places, "place")}`
                : plural(tally.trips, "trip")
            }
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
            onPress={() => onOpenActivity(tally.type)}
          />
        );
      })}
      {/* Load-bearing, not decoration: a trip tagged twice is counted under both
          tags, so without this the rows visibly out-sum the trip tile above and
          read as a bug. */}
      {multiTagged ? (
        <Text style={styles.caption}>
          a trip with two tags counts under both
        </Text>
      ) : null}
    </View>
  );
}

/**
 * How much of the library the trips in range actually reached — "Places" alone
 * left the reader guessing whether the bar was places stored or places been to.
 * The row reads "29 of 31", so the header only has to name the verb.
 */
function PlacesVisited({ stats }: { stats: LogbookStats }) {
  if (stats.completion.length === 0) return null;
  return (
    <View style={styles.section}>
      <SectionHeader label="Places visited" />
      <Card>
        {stats.completion.map((entry) => (
          <View key={entry.typeId} style={styles.meterRow}>
            <View style={styles.meterLabels}>
              <Text style={styles.meterName}>{entry.name}</Text>
              <Text style={styles.meterValue}>
                {entry.logged} of {entry.total}
              </Text>
            </View>
            <View style={styles.meterTrack}>
              <View
                style={[
                  styles.meterFill,
                  {
                    // `flexGrow` rather than a percentage width: a zero-logged
                    // type still has to render its track, and a 0 % width child
                    // inside a rounded, clipped bar is the empty-card trap
                    // DESIGN.md warns about.
                    flexGrow: Math.max(entry.logged, 0),
                    backgroundColor: entry.color,
                  },
                ]}
              />
              <View style={{ flexGrow: Math.max(entry.total - entry.logged, 0) }} />
            </View>
          </View>
        ))}
        {stats.mostReturned ? (
          <Text style={styles.cadence}>
            most returned to · {stats.mostReturned.name} ×{stats.mostReturned.trips}
          </Text>
        ) : null}
      </Card>
    </View>
  );
}

/**
 * Recordings, and the caption is not optional.
 *
 * A `Track` carries no trip or place id — a finished recording is serialised to
 * a standalone media row and nothing links it to the trip it was recorded on —
 * so these kilometres are a PARALLEL record of the same days, not a breakdown
 * of the trips above. Presenting them without saying so invites the reader to
 * divide one by the other.
 */
function OnFoot({
  tracks,
  range,
}: {
  tracks: { startedAt: string; distanceM: number; durationMs: number; elevationGainM: number }[];
  range: LogbookRange;
}) {
  // A recording with no distance has nothing to say — an armed-and-cancelled
  // recorder would otherwise render a grid of zeros, the same reason
  // `TrackStatsBody` omits a cell rather than showing 0.
  const inRange = tracks.filter((track) => {
    if (!(track.distanceM > 0)) return false;
    // `startedAt` is a real instant, unlike a trip's date-only value, so its
    // calendar day is the LOCAL one — the day the user would say they recorded
    // it on.
    const started = new Date(track.startedAt);
    const key = `${started.getFullYear()}-${`${started.getMonth() + 1}`.padStart(2, "0")}-${`${started.getDate()}`.padStart(2, "0")}`;
    if (range.from && key < range.from) return false;
    if (range.to && key > range.to) return false;
    return true;
  });
  if (inRange.length === 0) return null;

  const distanceM = inRange.reduce((sum, track) => sum + track.distanceM, 0);
  const durationMs = inRange.reduce((sum, track) => sum + track.durationMs, 0);
  const ascentM = inRange.reduce((sum, track) => sum + track.elevationGainM, 0);
  const longest = inRange.reduce((top, track) =>
    track.distanceM > top.distanceM ? track : top,
  );

  return (
    <View style={styles.section}>
      <SectionHeader label="On foot" />
      <StatGrid
        stats={[
          { label: "Distance", value: formatDistanceM(distanceM) },
          { label: "Ascent", value: `${Math.round(ascentM)} m` },
          { label: "Time", value: formatDurationMs(durationMs) },
          { label: "Longest", value: formatDistanceM(longest.distanceM) },
        ]}
      />
      <Text style={styles.caption}>
        {`from ${plural(inRange.length, "recording")} on this phone — recordings aren't linked to trips, so these are the same days seen another way`}
      </Text>
    </View>
  );
}

/**
 * The generic half: every attribute the user has answered, rendered by the
 * SHAPE of its definition rather than by its name. A bounded number is a rating
 * and gets a distribution; an open one is a quantity and gets a total; a yes/no
 * gets a count; a short vocabulary gets its tally. Nothing here knows what a
 * canyon is.
 *
 * PLACE attributes are grouped by the type of place they belong to. A canyoning
 * trip that also stopped at a campsite carries the campsite's fields too, which
 * is correct and unavoidable — so "Capacity" sitting under "Longest pitch" is
 * not a fault to fix but a fact to LABEL, and the type heading is the label.
 */
function AttributeSections({
  stats,
  tripOnly = false,
}: {
  stats: LogbookStats;
  tripOnly?: boolean;
}) {
  const groups = tripOnly ? [] : stats.placeFieldStats;
  const underActivities = stats.tripFieldsUnderActivities;
  if (
    groups.length === 0 &&
    stats.tripFieldStats.length === 0 &&
    underActivities === 0
  ) {
    return null;
  }
  return (
    <View style={styles.section}>
      {groups.map((group) => (
        <View key={group.typeId} style={styles.section}>
          <SectionHeader label={`${group.name} attributes`} />
          {group.stats.map((entry) => (
            <AttributeStat key={`${group.typeId}:${entry.key}`} stat={entry} />
          ))}
        </View>
      ))}
      {stats.tripFieldStats.length > 0 || underActivities > 0 ? (
        <View style={styles.section}>
          <SectionHeader label="Trip attributes" />
          {stats.tripFieldStats.map((entry) => (
            <AttributeStat key={`trip:${entry.key}`} stat={entry} />
          ))}
          {/* Load-bearing, like the multi-tag caption: an attribute scoped to
              one activity is summarised on that activity's screen only, so
              without this it reads as having vanished from the logbook. */}
          {underActivities > 0 ? (
            <Text style={styles.caption}>
              {underActivities === 1
                ? "1 more attribute belongs to a single activity — open that activity above to see it"
                : `${underActivities} more attributes belong to single activities — open an activity above to see them`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * EVERY attribute is a `Row`, distribution or not.
 *
 * The rating cards used `Card` and the rest used `Row`, which differ by four
 * points of corner radius and by whether the parent supplies a gap — so a list
 * of attributes rendered as two visibly different kinds of card, unevenly
 * spaced. `Row`'s `footer` slot exists for exactly this: full-width content
 * pinned under the row's own line, inside the same card.
 */
function AttributeStat({ stat }: { stat: FieldStat }) {
  if (stat.kind === "rating") {
    // No per-year progression line. It read as a claim about the user getting
    // better, which is not what a grade distribution over trips measures, is
    // not how canyon grades work, and is not a thing every user is doing.
    const caption = stat.best
      ? `highest ${formatNumber(stat.best.value)} · ${stat.best.label}`
      : undefined;
    return (
      <Row
        title={stat.label}
        titleNumberOfLines={1}
        right={<RowMetric value={formatNumber(stat.average)} suffix="avg" />}
        footer={
          <ActivitySpark
            buckets={stat.buckets.map((bucket) => ({
              label: `${bucket.value}`,
              count: bucket.count,
            }))}
            caption={caption}
          />
        }
      />
    );
  }

  if (stat.kind === "quantity") {
    // NO TOTALS, on either side, and that is a decision rather than an
    // omission. A total is only honest for a quantity a trip SPENDS, and
    // nothing in a definition says which ones those are — not the bounds, not
    // `min`, not which list the value came from. Summing a place property gave
    // "1996 longest pitch" and "48 capacity"; summing a trip property gave
    // "1530 rope length". An average and a highest are never wrong for either.
    //
    // "471 pitches abseiled" is worth having back, and needs the one thing that
    // could make it correct: an "adds up each trip" flag on the definition,
    // answered by the person who created the field.
    return (
      <Row
        title={stat.label}
        titleNumberOfLines={1}
        subtitle={
          stat.best
            ? `highest ${formatNumber(stat.best.value)}, ${stat.best.label}`
            : undefined
        }
        right={<RowMetric value={formatNumber(stat.average)} suffix="avg" />}
      />
    );
  }

  if (stat.kind === "boolean") {
    return (
      <Row
        title={stat.label}
        titleNumberOfLines={1}
        subtitle={`of ${plural(stat.of, "trip")} answered`}
        right={<RowMetric value={`${stat.yes}`} suffix="yes" />}
      />
    );
  }

  return (
    <Row
      title={stat.label}
      titleNumberOfLines={1}
      // "×" rather than a space: a value can contain spaces of its own, and
      // "NPWS-2026-114 4" read as part of the identifier. The multiplication
      // sign is what the places section already counts repeats with.
      subtitle={stat.values
        .map((entry) => `${entry.value} ×${entry.count}`)
        .join(" · ")}
    />
  );
}

/** A number with a dimmed unit beside it. The bare figure on the right edge
 *  read as disconnected from the words explaining it — this puts the word that
 *  names it in the same breath, and lets the subtitle be about something else. */
function RowMetric({ value, suffix }: { value: string; suffix: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.rowValue}>{value}</Text>
      <Text style={styles.metricSuffix}>{suffix}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  // `ScreenScroll` gaps its own direct children; a section wrapping several
  // rows has to repeat that or its rows sit flush against each other.
  section: { gap: spacing(1) },
  metric: { flexDirection: "row", alignItems: "baseline", gap: spacing(0.5) },
  metricSuffix: { color: theme.textMuted, fontSize: fontSize.sm },
  rail: { flexDirection: "row", gap: spacing(0.5), paddingRight: spacing(2) },
  block: { marginTop: spacing(1) },
  caption: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    marginTop: spacing(0.5),
  },
  cadence: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    marginTop: spacing(0.25),
  },
  rowValue: {
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  meterRow: { marginBottom: spacing(1) },
  meterLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing(0.5),
  },
  meterName: { color: theme.textPrimary, fontSize: fontSize.sm },
  meterValue: { color: theme.textMuted, fontSize: fontSize.xs },
  meterTrack: {
    flexDirection: "row",
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: withAlpha(theme.textPrimary, 0.08),
  },
  meterFill: { borderRadius: 4 },
});
