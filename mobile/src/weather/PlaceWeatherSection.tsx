// "Show the weather here" on a place's page: one row until it is pressed (or
// until the phone already holds this cell's forecast), then the forecast in
// place. Opening the page sends nothing (ADR 0035).
import { useState } from "react";
import { WEATHER, weatherCell, weatherCellKey } from "@logjam/shared";

import { isOfflineOnly } from "../offline/offlineOnlyMode";
import { Row } from "../ui";
import { useWeather } from "./useWeather";
import { showWeatherRow } from "./weatherState";
import { WeatherView } from "./WeatherView";

type Spot = { latitude: number; longitude: number; elevation: number | null };

// Keyed by the cell: a place edited to another one starts at its row again
// rather than showing a press that asked about the old cell.
export function PlaceWeatherSection({ place }: { place: Spot }) {
  return (
    <Section
      key={weatherCellKey(weatherCell(place, place.elevation))}
      place={place}
    />
  );
}

function Section({ place }: { place: Spot }) {
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
