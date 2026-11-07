import { useEffect, useState } from "react";
import {
  MAP_TERRAIN,
  WEATHER,
  WEATHER_MAP,
  type WeatherLayerKey,
} from "@logjam/shared";
import { IconButton, Notice, Scrubber } from "../../ui";
import {
  weatherView,
  type WeatherMapState,
  type WeatherPick,
} from "./weatherView";
import classes from "./WeatherBar.module.css";

const copy = MAP_TERRAIN.copy;

/**
 * Weather's notice in the map's stack while it is on: what the layer is and
 * which time it shows, a scrubber over the steps still to come (a total has
 * none) and the run's age; or why there is nothing to show.
 *
 * It holds the step while the scrubber moves and tells the app (`onSettle`)
 * only once it rests, so a drag re-renders the bar and not the app, and the
 * map is asked for the archive of the step it rests on, not each notch.
 */
export default function WeatherBar({
  state,
  layerKey,
  now,
  settled,
  onSettle,
  online,
  onRetry,
}: {
  state: WeatherMapState;
  layerKey: WeatherLayerKey;
  now: number;
  settled: WeatherPick | null;
  onSettle: (pick: WeatherPick) => void;
  online: boolean;
  onRetry: () => void;
}) {
  const [pick, setPick] = useState(settled);
  useEffect(() => {
    if (!pick) return;
    const timer = setTimeout(() => onSettle(pick), WEATHER_MAP.settleMs);
    return () => clearTimeout(timer);
  }, [pick, onSettle]);
  const view = weatherView({ on: true, state, layerKey, pick, now });
  const path = state.status === "ready" ? state.file.path : null;
  const onStep = (step: number) => path && setPick({ path, step });
  if (view.kind === "off") return null;
  if (view.kind === "loading")
    return <Notice icon="weatherMap">{copy.weatherLoading}</Notice>;
  if (view.kind !== "ready")
    return (
      <Notice
        icon="warning"
        tone="warning"
        action={
          view.kind === "failed" && online ? (
            <IconButton
              icon="retry"
              label={WEATHER.copy.tryAgain}
              onClick={onRetry}
            />
          ) : undefined
        }
      >
        {view.kind === "outOfDate" ? copy.weatherOutOfDate : copy.weatherFailed}
      </Notice>
    );
  const { layer, step, first, last, shown, age } = view;
  return (
    <Notice
      icon="weatherMap"
      quiet
      controls={
        step !== null && (
          <>
            <IconButton
              icon="earlier"
              label={copy.weatherEarlier}
              onClick={() => onStep(Math.max(first, step - 1))}
            />
            <Scrubber
              first={first}
              last={last}
              value={step}
              onChange={onStep}
              label={layer.label}
              valueText={shown}
            />
            <IconButton
              icon="later"
              label={copy.weatherLater}
              onClick={() => onStep(Math.min(last, step + 1))}
            />
          </>
        )
      }
    >
      {layer.label} <span className={classes.muted}>{layer.unit}</span> ·{" "}
      {shown} · <span className={classes.muted}>{age}</span>
    </Notice>
  );
}
