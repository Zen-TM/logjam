// "Show the weather here" on a place's page: one row until it is pressed (or
// until the phone already holds this cell's forecast), then the forecast in
// place. Opening the page sends nothing (ADR 0035).
import { useState } from "react";
import { WEATHER } from "@logjam/shared";

import { isOfflineOnly } from "../offline/offlineOnlyMode";
import { Row } from "../ui";
import { useWeather } from "./useWeather";
import { showWeatherRow } from "./weatherState";
import { WeatherView } from "./WeatherView";

export function PlaceWeatherSection({
  place,
}: {
  place: { latitude: number; longitude: number; elevation: number | null };
}) {
  const weather = useWeather(place, place.elevation, !isOfflineOnly());
  const [pressed, setPressed] = useState(false);

  if (pressed || weather.forecast) return <WeatherView weather={weather} />;

  const row = showWeatherRow(weather);
  return (
    <Row
      icon="weather"
      title={WEATHER.copy.show}
      subtitle={row.reason}
      disabled={row.disabled}
      onPress={() => {
        setPressed(true);
        weather.refresh();
      }}
    />
  );
}
