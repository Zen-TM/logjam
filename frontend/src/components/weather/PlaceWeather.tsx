import { useState } from "react";
import { WEATHER } from "@logjam/shared";
import { IconTile, Row } from "../../ui";
import { WeatherView } from "./WeatherView";
import { useOnline, useWeather } from "./useWeather";

/**
 * "Show the weather here" on a place's page: one row until it is pressed, then
 * the forecast in its place. Keyed by the place, so a forecast never outlives
 * the place it was asked for.
 */
export function PlaceWeather({
  point,
  elevationM,
}: {
  point: { latitude: number; longitude: number };
  elevationM: number | null;
}) {
  const online = useOnline();
  const weather = useWeather(point, elevationM);
  // Hiding keeps the forecast, so showing it again asks nothing (ADR 0038).
  const [hidden, setHidden] = useState(false);
  if (weather.state.status !== "idle" && !hidden)
    return (
      <WeatherView
        state={weather.state}
        online={online}
        onLoad={weather.load}
        model={weather.model}
        onModel={weather.chooseModel}
        onHide={() => setHidden(true)}
      />
    );
  return (
    <Row
      leading={<IconTile icon="weather" hue="var(--color-accent)" />}
      title={WEATHER.copy.show}
      {...(online || hidden
        ? {}
        : { disabled: true, subtitle: WEATHER.copy.needsConnection })}
      onOpen={() => {
        if (hidden) setHidden(false);
        else weather.load();
      }}
    />
  );
}
