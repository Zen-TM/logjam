import { useEffect, useRef, type ReactNode } from "react";
import {
  WEATHER,
  WEATHER_CREDIT_URL,
  WEATHER_MODELS,
  contractSectionKeys,
  weatherAge,
  weatherDaysFrom,
  weatherRows,
  type WeatherForecast,
  type WeatherModelId,
  type WeatherRow,
} from "@logjam/shared";
import { Button, ErrorState, ForecastRail, LoadingState, Menu } from "../../ui";
import type { WeatherState } from "./useWeather";
import classes from "./WeatherView.module.css";

/**
 * The weather at a spot, drawn from `WEATHER` (shared/contracts): the hours and
 * days ahead, the rain that has fallen, and the credit CC BY 4.0 asks for. It only draws;
 * `useWeather` is what fetches, and only on a press.
 */
export function WeatherView(props: {
  state: WeatherState;
  online: boolean;
  /** Fetches again: Refresh, and Try again after a failure. */
  onLoad: () => void;
  /** The forecast model asked for, and what choosing another does. */
  model: WeatherModelId;
  onModel: (model: WeatherModelId) => void;
  /** Folds the forecast back to its row; the figures stay for the next open. */
  onHide?: () => void;
  now?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { status } = props.state;
  // Each state swaps out the control that was pressed (Show, Refresh, Try
  // again): focus it lost to the page goes to this view instead, so the
  // keyboard stays in the panel and Escape still reaches the popover.
  useEffect(() => {
    const el = ref.current;
    if (
      el &&
      (document.activeElement === document.body ||
        el.contains(document.activeElement))
    )
      el.focus({ preventScroll: true });
  }, [status]);
  return (
    <div ref={ref} tabIndex={-1} className={classes.root}>
      <WeatherBody {...props} />
    </div>
  );
}

function WeatherBody({
  state,
  online,
  onLoad,
  model,
  onModel,
  onHide,
  now: fixedNow,
}: Parameters<typeof WeatherView>[0]) {
  if (state.status === "idle" || state.status === "loading")
    return <LoadingState label={WEATHER.copy.loading} />;
  if (state.status === "failed")
    return (
      <ErrorState
        message={WEATHER.copy.failed}
        onRetry={online ? onLoad : undefined}
      />
    );
  const { forecast } = state;
  const now = fixedNow ?? state.now;
  const rows = weatherRows(forecast, now);
  const row = (key: WeatherRow["key"]) => {
    const found = rows.find((r) => r.key === key);
    if (found)
      return (
        <ForecastRail
          title={found.title}
          summary={found.summary}
          labels={{
            back: `${WEATHER.copy.earlier}: ${found.title}`,
            on: `${WEATHER.copy.later}: ${found.title}`,
          }}
          cards={found.cards}
        />
      );
    // Every day the forecast held is past; its hours went with them.
    return key === "days" && weatherDaysFrom(forecast, now).length === 0 ? (
      <p className={classes.muted}>{WEATHER.copy.outOfDate}</p>
    ) : null;
  };
  const sections: Record<
    (typeof WEATHER.sections)[number]["key"],
    () => ReactNode
  > = {
    hours: () => row("hours"),
    days: () => row("days"),
    past: () => row("past"),
    credit: () => (
      <a
        className={classes.credit}
        href={WEATHER_CREDIT_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {WEATHER.copy.credit}
      </a>
    ),
  };
  return (
    <div className={classes.view}>
      <Header
        forecast={forecast}
        online={online}
        now={now}
        onLoad={onLoad}
        model={model}
        onModel={onModel}
        onHide={onHide}
      />
      {contractSectionKeys(WEATHER, "web").map((key) => (
        <div key={key}>{sections[key]()}</div>
      ))}
    </div>
  );
}

function Header({
  forecast,
  online,
  now,
  onLoad,
  model,
  onModel,
  onHide,
}: {
  forecast: WeatherForecast;
  online: boolean;
  now: number;
  onLoad: () => void;
  model: WeatherModelId;
  onModel: (model: WeatherModelId) => void;
  onHide?: () => void;
}) {
  const current = WEATHER_MODELS.find((m) => m.id === model);
  return (
    <div className={classes.header}>
      <span className={classes.age}>{weatherAge(forecast.fetchedAt, now)}</span>
      <div className={classes.actions}>
        <Menu
          label={WEATHER.copy.model}
          title={WEATHER.copy.modelHint}
          placement="bottom-end"
          entries={WEATHER_MODELS.map(({ id, label }) => ({
            id,
            label,
            icon: id === model ? "done" : undefined,
            accessibleLabel: id === model ? `${label}, current` : undefined,
            // Offline a choice could only show nothing (shared/DESIGN.md §5).
            disabledReason: online ? undefined : WEATHER.copy.needsConnection,
            onSelect: () => onModel(id),
          }))}
          trigger={(props) => (
            <Button
              {...props}
              variant="outline"
              compact
              trailingIcon="expand"
              aria-label={`${WEATHER.copy.model}: ${current?.label}`}
            >
              {current?.label}
            </Button>
          )}
        />
        <Button
          variant="outline"
          compact
          icon="refresh"
          onClick={onLoad}
          disabled={!online}
          disabledReason={WEATHER.copy.needsConnection}
        >
          {WEATHER.copy.refresh}
        </Button>
        {onHide && (
          <Button variant="outline" compact onClick={onHide}>
            {WEATHER.copy.hide}
          </Button>
        )}
      </div>
    </div>
  );
}
