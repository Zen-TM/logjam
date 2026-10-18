import { useEffect, useRef, type ReactNode } from "react";
import {
  WEATHER,
  WEATHER_CREDIT_URL,
  contractSectionKeys,
  formatRainMm,
  localDate,
  weatherAge,
  weatherDayFacts,
  weatherDaysFrom,
  type WeatherForecast,
} from "@logjam/shared";
import {
  Button,
  ErrorState,
  ForecastList,
  LoadingState,
  StatGrid,
} from "../../ui";
import type { WeatherState } from "./useWeather";
import classes from "./WeatherView.module.css";

/**
 * The weather at a spot, drawn from `WEATHER` (shared/contracts): the rain that
 * has fallen, the days ahead, and the credit CC BY 4.0 asks for. It only draws;
 * `useWeather` is what fetches, and only on a press.
 */
export function WeatherView(props: {
  state: WeatherState;
  online: boolean;
  /** Fetches again: Refresh, and Try again after a failure. */
  onLoad: () => void;
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
  const days = weatherDaysFrom(forecast, now);
  const sections: Record<
    (typeof WEATHER.sections)[number]["key"],
    () => ReactNode
  > = {
    pastRain: () => (
      <StatGrid
        stats={[
          {
            label: WEATHER.copy.pastRain,
            value: formatRainMm(forecast.pastRainMm),
            span: true,
          },
        ]}
      />
    ),
    days: () =>
      days.length === 0 ? (
        <p className={classes.muted}>{WEATHER.copy.outOfDate}</p>
      ) : (
        <ForecastList
          label={WEATHER.title}
          rows={days.map((day) => {
            const facts = weatherDayFacts(day, now);
            return {
              key: facts.date,
              day: facts.day,
              glyph: facts.condition.icon,
              glyphLabel: facts.condition.label,
              temperature: facts.temperature,
              rain: facts.rain,
              wind: facts.wind,
              current: facts.date === localDate(now),
            };
          })}
        />
      ),
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
      <Header forecast={forecast} online={online} now={now} onLoad={onLoad} />
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
}: {
  forecast: WeatherForecast;
  online: boolean;
  now: number;
  onLoad: () => void;
}) {
  return (
    <div className={classes.header}>
      <span className={classes.age}>{weatherAge(forecast.fetchedAt, now)}</span>
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
    </div>
  );
}
