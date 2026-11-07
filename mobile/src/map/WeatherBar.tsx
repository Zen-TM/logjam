import { useWindowDimensions, View } from "react-native";
import { MAP_TERRAIN, WEATHER } from "@logjam/shared";

import { IconButton, Notice } from "../ui";
import { makeStyles, spacing, useTheme } from "../theme";
import { type WeatherBarModel } from "../weatherMap/weatherBar";
import { WeatherScrubber } from "./WeatherScrubber";

const copy = MAP_TERRAIN.copy;

/**
 * The bar over the map while Weather is on, in the top notice stack
 * (DESIGN.md §3): what is shown and how old it is, and for a stepped layer
 * Earlier and Later around a scrubber. The same words as Logjam Web's bar.
 */
export function WeatherBar({
  model,
  onStep,
  onRetry,
}: {
  model: WeatherBarModel;
  onStep: (step: number) => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const { width: screen } = useWindowDimensions();
  // The screen less the stack's margins, the notice's padding and its two buttons.
  const width = Math.min(
    280,
    screen - spacing(2) * 2 - spacing(1.5) * 2 - 40 * 2 - spacing(0.5) * 2,
  );
  if (model.kind === "loading")
    return <Notice icon="weatherRain">{model.text}</Notice>;
  if (model.kind === "outOfDate")
    return (
      <Notice icon="warning" tone="warning">
        {model.text}
      </Notice>
    );
  if (model.kind === "failed")
    return (
      <Notice
        icon="warning"
        tone="warning"
        action={
          model.canRetry ? (
            <IconButton
              icon="retry"
              accessibilityLabel={WEATHER.copy.tryAgain}
              color={theme.text}
              onPress={onRetry}
            />
          ) : undefined
        }
      >
        {model.text}
      </Notice>
    );
  const { scrub } = model;
  return (
    <Notice
      icon="weatherRain"
      controls={
        scrub ? (
          <View style={styles.scrub}>
            <IconButton
              icon="back"
              accessibilityLabel={copy.weatherEarlier}
              color={theme.text}
              onPress={() => onStep(scrub.step - 1)}
            />
            <WeatherScrubber
              first={scrub.first}
              last={scrub.last}
              step={scrub.step}
              value={scrub.value}
              width={width}
              onChange={onStep}
            />
            <IconButton
              icon="forward"
              accessibilityLabel={copy.weatherLater}
              color={theme.text}
              onPress={() => onStep(scrub.step + 1)}
            />
          </View>
        ) : undefined
      }
    >
      {`${model.title}\n${model.detail}`}
    </Notice>
  );
}

const useStyles = makeStyles(() => ({
  scrub: { flexDirection: "row", alignItems: "center", gap: spacing(0.5) },
}));
