import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import {
  activityTalliesOverlap,
  activityTallySubtitle,
  computeLogbookStats,
  contractSectionKeys,
  fieldStatDisplay,
  logbookActivityLabel,
  logbookRanges,
  STATS,
  statsCadence,
  statsEmptyActivityBody,
  statsHeadline,
  statsHeroTitle,
  statsMostReturnedLine,
  statsPlaceAttributesTitle,
  statsSpark,
  statsTruncatedNote,
  statsUnderActivitiesNote,
  tripYear,
  UNTAGGED_ACTIVITY,
  type FieldStat,
  type LogbookRange,
  type LogbookStats,
  type ScopedCustomFieldDef,
  type SectionKeysOn,
  type StatsSpark,
} from "@logjam/shared";

const copy = STATS.copy;
import type { TPlace, TPlaceType, TTripLog } from "../../../placeUtils";
import { useStoredState } from "../../../useStoredState";
import {
  ActivitySpark,
  ChipRail,
  EmptyState,
  Hero,
  IconTile,
  ProgressBar,
  Row,
  SectionHeader,
  StatGrid,
  type SparkBucket,
  Icon,
  LoadingState,
} from "../../../ui";
import { placeTypeLucideIcon } from "./placeTypeIcon";
import { tripTypeLook } from "./tripTypeIcon";
import classes from "./AnalyticsPanel.module.css";

/** Each bar named in full for assistive tech: an initial read aloud says nothing. */
function namedBuckets(spark: StatsSpark): SparkBucket[] {
  return spark.buckets.map((bucket, index) => ({
    ...bucket,
    name:
      spark.axis === "year"
        ? `${spark.firstYear + index}`
        : new Date(Date.UTC(spark.year, index, 1)).toLocaleDateString(
            undefined,
            {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            },
          ),
  }));
}

/**
 * Stats: "how much, and of what?" (Logjam GPS's `StatsScreen`). The hero leads
 * with DAYS OUT, the number the Logs list cannot give; a rail picks the window
 * every number below is read in. An activity row opens that activity in place,
 * with a back arrow in the hero. Every number is `computeLogbookStats` over the
 * loaded trips and every sentence the shared presentation helpers, so the phone
 * and the browser cannot disagree.
 *
 * Logjam GPS's "On foot" section is absent: it reads recordings on that phone,
 * which Logjam Web does not have.
 */
function AnalyticsPanel({
  views,
  tripLogs,
  tripLogsTotal,
  loaded,
  places,
  customFieldDefs,
  placeCustomFieldDefs,
  placeTypes,
}: {
  /** The Logs | Stats switch, drawn under the hero. */
  views: ReactNode;
  tripLogs: TTripLog[];
  tripLogsTotal: number | null;
  loaded: boolean;
  /** The user's OWN places. A shared place is someone else's ground; counting
   *  it would inflate "places visited" with rows the user never kept. */
  places: TPlace[];
  customFieldDefs: ScopedCustomFieldDef[];
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  placeTypes: TPlaceType[];
}) {
  const [activity, setActivity] = useState<string | null>(null);
  // Remembered like a preference, as on the phone: the window numbers are read
  // in should not reset every visit.
  const [rangeLabel, setRangeLabel] = useStoredState(
    "logjam.logbookStatsRange",
    "All time",
  );
  const rootRef = useRef<HTMLDivElement>(null);

  const ranges = useMemo(
    () => logbookRanges(tripLogs.map((trip) => tripYear(trip.date))),
    [tripLogs],
  );
  const range: LogbookRange =
    ranges.find((entry) => entry.label === rangeLabel) ?? ranges[0];

  const stats = useMemo(
    () =>
      computeLogbookStats({
        trips: tripLogs.map((trip) => ({
          id: trip.id,
          date: trip.date,
          types: trip.types,
          places: trip.places,
          customFields: trip.customFields,
        })),
        places: places.map((place) => ({
          id: place.id,
          name: place.name,
          placeTypeId: place.placeTypeId,
          fieldValues: place.fieldValues,
        })),
        tripDefs: customFieldDefs,
        placeDefs: placeCustomFieldDefs,
        placeTypes: placeTypes.map((type) => ({
          id: type.id,
          name: type.name,
          color: type.color,
        })),
        from: range.from,
        to: range.to,
        activity,
      }),
    [
      tripLogs,
      places,
      customFieldDefs,
      placeCustomFieldDefs,
      placeTypes,
      range,
      activity,
    ],
  );

  // Focus follows the step: into the activity, onto the back arrow; back out,
  // onto the row that was opened. Both are gone from the page otherwise.
  const openActivity = (type: string, index: number) => {
    setActivity(type);
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>("header button")?.focus(),
    );
    lastOpened.current = index;
  };
  const lastOpened = useRef(0);
  const closeActivity = () => {
    setActivity(null);
    requestAnimationFrame(() =>
      rootRef.current
        ?.querySelector<HTMLElement>(
          `[data-activity-index="${lastOpened.current}"] button`,
        )
        ?.focus(),
    );
  };

  const title = !loaded
    ? STATS.title
    : activity
      ? logbookActivityLabel(activity)
      : statsHeroTitle(stats.days);

  const status = !loaded ? (
    <div className={classes.emptyArea} role="status">
      <LoadingState label={copy.loading} />
    </div>
  ) : stats.trips === 0 ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon="stats"
        title={copy.emptyTitle}
        body={
          activity
            ? statsEmptyActivityBody(logbookActivityLabel(activity))
            : copy.emptyBody
        }
      />
    </div>
  ) : null;

  const showing = loaded && stats.trips > 0;
  // Exhaustive by type: a section the contract names and this panel does not
  // draw, or the reverse, fails `tsc` (`STATS`, shared/src/contracts).
  const sections: Record<
    SectionKeysOn<typeof STATS, "web">,
    () => ReactNode
  > = {
    hero: () => (
      <>
        <Hero
          title={title}
          onBack={activity ? closeActivity : undefined}
          backLabel={copy.backToActivities}
        />
        <div className={classes.rails}>
          {views}
          {tripLogs.length > 0 && (
            <ChipRail
              label="Period"
              options={ranges.map((entry) => ({
                value: entry.label,
                label: entry.label,
              }))}
              value={range.label}
              onChange={setRangeLabel}
            />
          )}
        </div>
      </>
    ),
    truncated: () =>
      tripLogsTotal != null && tripLogsTotal > tripLogs.length ? (
        <p className={classes.caption}>
          {statsTruncatedNote(tripLogs.length, tripLogsTotal)}
        </p>
      ) : null,
    spark: () => <SparkBlock stats={stats} range={range} activity={activity} />,
    headline: () => (
      <StatGrid
        stats={statsHeadline(
          stats,
          activity,
          range.from != null || range.to != null,
        )}
      />
    ),
    activities: () =>
      activity ? null : <Activities stats={stats} onOpen={openActivity} />,
    placesVisited: () =>
      activity ? null : <PlacesVisited stats={stats} placeTypes={placeTypes} />,
    attributes: () => <AttributeSections stats={stats} tripOnly={!activity} />,
  };
  const keys = contractSectionKeys(STATS, "web");
  const render = (key: (typeof keys)[number]) => (
    <Fragment key={key}>{sections[key]()}</Fragment>
  );

  return (
    <div ref={rootRef} className={classes.root}>
      {render("hero")}
      {showing ? (
        <div className={classes.list}>
          {keys.filter((key) => key !== "hero").map(render)}
        </div>
      ) : (
        status
      )}
    </div>
  );
}

function SparkBlock({
  stats,
  range,
  activity,
}: {
  stats: LogbookStats;
  range: LogbookRange;
  activity: string | null;
}) {
  const spark = statsSpark(stats, range);
  const { busiest, lines } = statsCadence(stats, activity);
  return (
    <div className={classes.block}>
      <ActivitySpark
        label={
          spark.axis === "year"
            ? "Trips per year"
            : `Trips per month in ${spark.year}`
        }
        buckets={namedBuckets(spark)}
        caption={busiest}
      />
      {lines.map((line) => (
        <p key={line} className={classes.caption}>
          {line}
        </p>
      ))}
    </div>
  );
}

function Activities({
  stats,
  onOpen,
}: {
  stats: LogbookStats;
  onOpen: (type: string, index: number) => void;
}) {
  if (stats.activityTallies.length === 0) return null;
  return (
    <section className={classes.section}>
      <SectionHeader title={copy.byActivity} />
      {stats.activityTallies.map((tally, index) => {
        const look = tripTypeLook(
          tally.type === UNTAGGED_ACTIVITY ? null : tally.type,
        );
        return (
          <Row
            key={tally.type}
            data-activity-index={index}
            title={logbookActivityLabel(tally.type)}
            subtitle={activityTallySubtitle(tally)}
            leading={<IconTile icon={look.icon} hue={look.hue} />}
            trailing={
              <Icon
                idea="disclosure"
                size={18}
                aria-hidden
                className={classes.chevron}
              />
            }
            onOpen={() => onOpen(tally.type, index)}
          />
        );
      })}
      {/* Load-bearing: a trip tagged twice counts under both tags, so without
          this the rows out-sum the trip tile above and read as a bug. */}
      {activityTalliesOverlap(stats) && (
        <p className={classes.caption}>{copy.multiTagged}</p>
      )}
    </section>
  );
}

/** How much of each kind of place the trips in range reached. The row says
 *  "29 of 31"; the bar under it is that fraction for the eye. */
function PlacesVisited({
  stats,
  placeTypes,
}: {
  stats: LogbookStats;
  placeTypes: TPlaceType[];
}) {
  if (stats.completion.length === 0) return null;
  return (
    <section className={classes.section}>
      <SectionHeader title={copy.placesVisited} />
      {stats.completion.map((entry) => {
        const type = placeTypes.find(
          (candidate) => candidate.id === entry.typeId,
        );
        return (
          <Row
            key={entry.typeId}
            title={entry.name}
            leading={
              type ? (
                <IconTile
                  icon={placeTypeLucideIcon(type.iconKey)}
                  hue={entry.color}
                />
              ) : undefined
            }
            trailing={
              <span className={classes.metric}>
                <b>{entry.logged}</b> of {entry.total}
              </span>
            }
            footer={
              <div className={classes.bar}>
                <ProgressBar
                  label={`${entry.name}: ${entry.logged} of ${entry.total} visited`}
                  value={
                    entry.total === 0 ? 0 : (entry.logged / entry.total) * 100
                  }
                />
              </div>
            }
          />
        );
      })}
      {stats.mostReturned && (
        <p className={classes.caption}>
          {statsMostReturnedLine(
            stats.mostReturned.name,
            stats.mostReturned.trips,
          )}
        </p>
      )}
    </section>
  );
}

/**
 * Every attribute the user has answered, drawn by the SHAPE of its definition,
 * never its name. Place attributes are grouped by the type of place they belong
 * to: a canyoning trip that also stopped at a campsite carries the campsite's
 * fields too, and the type heading is what labels that.
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
  return (
    <>
      {groups.map((group) => (
        <section key={group.typeId} className={classes.section}>
          <SectionHeader title={statsPlaceAttributesTitle(group.name)} />
          {group.stats.map((entry) => (
            <AttributeStat key={`${group.typeId}:${entry.key}`} stat={entry} />
          ))}
        </section>
      ))}
      {(stats.tripFieldStats.length > 0 || underActivities > 0) && (
        <section className={classes.section}>
          <SectionHeader title={copy.tripAttributes} />
          {stats.tripFieldStats.map((entry) => (
            <AttributeStat key={`trip:${entry.key}`} stat={entry} />
          ))}
          {/* Load-bearing, as on Logjam GPS: an attribute scoped to one
              activity is summarised on that activity's view only, so without
              this it reads as having vanished from the logbook. */}
          {underActivities > 0 && (
            <p className={classes.caption}>
              {statsUnderActivitiesNote(underActivities)}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function AttributeStat({ stat }: { stat: FieldStat }) {
  const display = fieldStatDisplay(stat);
  return (
    <Row
      title={stat.label}
      subtitle={display.subtitle}
      trailing={
        display.metric && (
          <span className={classes.metric}>
            <b>{display.metric.value}</b> {display.metric.suffix}
          </span>
        )
      }
      footer={
        display.buckets && (
          <div className={classes.bar}>
            <ActivitySpark
              label={`${stat.label}: trips at each value`}
              buckets={display.buckets.map((bucket) => ({
                label: `${bucket.value}`,
                name: `${bucket.value}`,
                count: bucket.count,
              }))}
              caption={display.caption}
            />
          </div>
        )
      }
    />
  );
}

export default AnalyticsPanel;
