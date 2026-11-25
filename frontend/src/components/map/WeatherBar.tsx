import { useCallback, useEffect, useState } from "react";
import {
  MAP_TERRAIN,
  WEATHER,
  WEATHER_MAP,
  type WeatherLayerKey,
  weatherNextStep,
  weatherScale,
} from "@logjam/shared";
import { ColourScale, IconButton, Notice, Scrubber } from "../../ui";
import {
  weatherView,
  type WeatherMapState,
  type WeatherPick,
} from "./weatherView";
import { useWeatherPlay } from "./useWeatherPlay";
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
 *
 * Play steps on by itself, once a `WEATHER_MAP.playMs`, and loops; it stops
 * when the user moves the scrubber or steps, the layer changes, the page is
 * hidden, or the bar unmounts. The X in every state is Weather's switch.
 */
export default function WeatherBar({
  state,
  layerKey,
  now,
  settled,
  onSettle,
  online,
  onRetry,
  onDismiss,
  onChooseLayer,
}: {
  state: WeatherMapState;
  layerKey: WeatherLayerKey;
  now: number;
  settled: WeatherPick | null;
  onSettle: (pick: WeatherPick) => void;
  online: boolean;
  onRetry: () => void;
  /** Turns Weather off, as its switch does. */
  onDismiss: () => void;
  /** Opens Layers, to pick what the map shows. */
  onChooseLayer: () => void;
}) {
  const [pick, setPick] = useState(settled);
  useEffect(() => {
    if (!pick) return;
    const timer = setTimeout(() => onSettle(pick), WEATHER_MAP.settleMs);
    return () => clearTimeout(timer);
  }, [pick, onSettle]);
  const view = weatherView({ on: true, state, layerKey, pick, now });
  const path = state.status === "ready" ? state.file.path : null;
  // Tied to the layer it was started on: a new layer opens paused.
  const [playingLayer, setPlayingLayer] = useState<WeatherLayerKey | null>(
    null,
  );
  const pause = useCallback(() => setPlayingLayer(null), []);
  const stepped = view.kind === "ready" && view.step !== null ? view : null;
  const playing = stepped !== null && playingLayer === layerKey;
  useWeatherPlay(
    playing,
    () => {
      if (path && stepped)
        setPick({
          path,
          step: weatherNextStep(stepped.step!, stepped.first, stepped.last),
        });
    },
    pause,
  );
  // The user's own moves: they stop Play.
  const onStep = (step: number) => {
    pause();
    if (path) setPick({ path, step });
  };
  const dismiss = (
    <IconButton
      icon="close"
      label={copy.weatherHide}
      size={14}
      round
      onClick={onDismiss}
    />
  );
  if (view.kind === "off") return null;
  if (view.kind === "loading")
    return (
      <Notice icon="weatherMap" action={dismiss}>
        {copy.weatherLoading}
      </Notice>
    );
  if (view.kind !== "ready")
    return (
      <Notice
        icon="warning"
        tone="warning"
        action={
          <>
            {view.kind === "failed" && online && (
              <IconButton
                icon="retry"
                label={WEATHER.copy.tryAgain}
                size={14}
                round
                onClick={onRetry}
              />
            )}
            {dismiss}
          </>
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
      fixedWidth
      action={dismiss}
      onText={onChooseLayer}
      textHint={copy.weatherChoose}
      controls={
        <span className={classes.controls}>
          {step !== null && (
            <span className={classes.scrub}>
              <IconButton
                icon={playing ? "pause" : "play"}
                label={playing ? copy.weatherPause : copy.weatherPlay}
                onClick={() => setPlayingLayer(playing ? null : layerKey)}
              />
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
            </span>
          )}
          <ColourScale stops={weatherScale(layer.key)} />
        </span>
      }
    >
      {/* Always two lines, each cut rather than wrapped, so the card keeps
          one height as the time and the layer change, as it keeps one width. */}
      <span className={classes.line}>
        {layer.label} <span className={classes.muted}>{layer.unit}</span>{" "}
      </span>
      <span className={classes.line}>
        {shown} · <span className={classes.muted}>{age}</span>
      </span>
    </Notice>
  );
}
