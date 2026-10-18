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
  if (weather.state.status !== "idle")
    return (
      <WeatherView
        state={weather.state}
        online={online}
        onLoad={weather.load}
      />
    );
  return (
    <Row
      leading={<IconTile icon="weather" hue="var(--color-accent)" />}
      title={WEATHER.copy.show}
      {...(online
        ? {}
        : { disabled: true, subtitle: WEATHER.copy.needsConnection })}
      onOpen={weather.load}
    />
  );
}
