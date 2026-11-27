import { useCallback, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import {
  MAP_TERRAIN,
  WEATHER,
  type WeatherLayerKey,
  type WeatherTotalKey,
  isWeatherTotal,
  weatherLayer,
  weatherNextStep,
  weatherPeriodHint,
  weatherPeriodOptions,
} from "@logjam/shared";

import {
  ChipRail,
  ColourScale,
  IconButton,
  Notice,
  SCRUBBER_WIDTH,
  Scrubber,
} from "../ui";
import { controlSize, makeStyles, spacing, useTheme } from "../theme";
import { type WeatherBarModel } from "../weatherMap/weatherBar";
import { useWeatherPlay } from "../weatherMap/useWeatherPlay";

const copy = MAP_TERRAIN.copy;

/**
 * The bar over the map while Weather is on, in the top notice stack
 * (DESIGN.md §3): what is shown and how old it is, and for a stepped layer
 * Play, then Earlier and Later around a scrubber. The same words as Logjam
 * Web's bar, from the same `weatherShown`. Compact: the stack is the map's
 * top, and a card a fifth of the screen high hides the map it is about.
 *
 * Play steps on by itself once a `WEATHER_MAP.playMs` and loops; the user's
 * own drag or press, a new layer, the app leaving the front, the Map tab or
 * screen losing focus (`active`), and the bar unmounting (Weather off) all stop it. The X in every state is Weather's
 * switch.
 */
export function WeatherBar({
  model,
  active,
  onStep,
  onRetry,
  onDismiss,
  onChooseLayer,
  onLayerChange,
}: {
  model: WeatherBarModel;
  /** Whether the Map tab is focused and the app in front (`sensorsActive`); Play runs only then. */
  active: boolean;
  onStep: (step: number) => void;
  onRetry: () => void;
  /** Turns Weather off, as its switch does. */
  onDismiss: () => void;
  /** Opens Layers, to pick what the map shows. */
  onChooseLayer: () => void;
  /** Picks a rain total's period from the card, as the Layers tab does. */
  onLayerChange: (layer: WeatherLayerKey) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { width: screen } = useWindowDimensions();
  // Tied to the layer it was started on: a new layer opens paused.
  const [playingLayer, setPlayingLayer] = useState<WeatherLayerKey | null>(
    null,
  );
  const pause = useCallback(() => setPlayingLayer(null), []);
  const stepped =
    model.kind === "ready" && model.scrub
      ? { layer: model.layer, ...model.scrub }
      : null;
  const playing = active && stepped !== null && playingLayer === stepped.layer;
  // Pause, not mask: a new layer, a state that is not stepped, or the map
  // losing focus forgets Play, so coming back does not restart it.
  if (playingLayer !== null && !playing) setPlayingLayer(null);
  useWeatherPlay(
    playing,
    () => {
      if (stepped)
        onStep(weatherNextStep(stepped.step, stepped.first, stepped.last));
    },
    pause,
  );
  // The user's own moves: they stop Play.
  const userStep = (step: number) => {
    pause();
    onStep(step);
  };
  // The screen less the stack's margins, the notice's padding, its three
  // buttons and the gaps between the four.
  const width = Math.min(
    SCRUBBER_WIDTH,
    screen -
      spacing(2) * 2 -
      spacing(1.5) * 2 -
      controlSize.sm * 3 -
      spacing(0.5) * 3,
  );
  const controlsWidth = width + controlSize.sm * 3 + spacing(0.5) * 3;
  const dismiss = (
    <IconButton
      icon="close"
      accessibilityLabel={copy.weatherHide}
      color={theme.text}
      size={16}
      compact
      onPress={onDismiss}
    />
  );
  if (model.kind === "loading")
    return (
      <Notice icon="weatherMap" action={dismiss}>
        {model.text}
      </Notice>
    );
  const periods = (layer?: WeatherLayerKey, totals?: WeatherTotalKey[]) =>
    layer && totals && isWeatherTotal(weatherLayer(layer)) ? (
      <ChipRail<WeatherTotalKey>
        key="periods"
        scroll
        label={copy.weatherPeriod}
        hint={weatherPeriodHint(totals)}
        options={weatherPeriodOptions(totals)}
        value={layer as WeatherTotalKey}
        onChange={onLayerChange}
      />
    ) : null;
  // A total the run lacks or has run out carries the rail; a stepped layer's
  // out-of-date card has none.
  if (model.kind === "missing" || (model.kind === "outOfDate" && model.layer))
    return (
      <Notice
        icon="warning"
        tone="warning"
        compact
        action={dismiss}
        controls={
          <View style={[styles.controls, { width: controlsWidth }]}>
            {periods(model.layer, model.totals)}
          </View>
        }
      >
        {model.text}
      </Notice>
    );
  if (model.kind === "outOfDate")
    return (
      <Notice icon="warning" tone="warning" action={dismiss}>
        {model.text}
      </Notice>
    );
  if (model.kind === "failed")
    return (
      <Notice
        icon="warning"
        tone="warning"
        action={
          <>
            {model.canRetry ? (
              <IconButton
                icon="retry"
                accessibilityLabel={WEATHER.copy.tryAgain}
                color={theme.text}
                size={16}
                compact
                onPress={onRetry}
              />
            ) : null}
            {dismiss}
          </>
        }
      >
        {model.text}
      </Notice>
    );
  const { scrub } = model;
  return (
    <Notice
      icon="weatherMap"
      compact
      action={dismiss}
      onText={onChooseLayer}
      textHint={copy.weatherChoose}
      controls={
        // As wide as the scrubber's row, so a total's scale (no scrubber)
        // still spaces its numbers.
        <View style={[styles.controls, { width: controlsWidth }]}>
          {scrub ? (
            <View style={styles.scrub}>
              <IconButton
                icon={playing ? "pause" : "play"}
                accessibilityLabel={
                  playing ? copy.weatherPause : copy.weatherPlay
                }
                color={theme.text}
                size={16}
                compact
                onPress={() => setPlayingLayer(playing ? null : model.layer)}
              />
              <IconButton
                icon="earlier"
                accessibilityLabel={copy.weatherEarlier}
                color={theme.text}
                size={16}
                compact
                onPress={() => userStep(scrub.step - 1)}
              />
              <Scrubber
                first={scrub.first}
                last={scrub.last}
                value={scrub.step}
                onChange={userStep}
                label={copy.weather}
                valueText={scrub.value}
                width={width}
                compact
              />
              <IconButton
                icon="later"
                accessibilityLabel={copy.weatherLater}
                color={theme.text}
                size={16}
                compact
                onPress={() => userStep(scrub.step + 1)}
              />
            </View>
          ) : null}
          {periods(model.layer, model.totals)}
          <ColourScale stops={model.scale} compact />
        </View>
      }
    >
      {`${model.title} · ${model.detail}`}
    </Notice>
  );
}

const useStyles = makeStyles(() => ({
  controls: { gap: spacing(0.25) },
  scrub: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
}));
