import { MAP_TERRAIN, WEATHER } from "@logjam/shared";
import { Button, IconButton } from "../../ui";
import type { WeatherView } from "./weatherView";
import classes from "./WeatherBar.module.css";

const copy = MAP_TERRAIN.copy;

/**
 * The bar over the map while Weather is on: what the layer is and which time
 * it shows, a scrubber over the steps still to come (a total has none), and
 * the run's age. The scrubber is a native range, so arrows, Home and End work
 * and a screen reader hears the time as its value.
 */
export default function WeatherBar({
  view,
  online,
  onStep,
  onRetry,
}: {
  view: WeatherView;
  online: boolean;
  onStep: (step: number) => void;
  onRetry: () => void;
}) {
  if (view.kind === "off") return null;
  if (view.kind !== "ready") {
    const text = {
      loading: copy.weatherLoading,
      failed: copy.weatherFailed,
      outOfDate: copy.weatherOutOfDate,
    }[view.kind];
    return (
      <div className={classes.bar} role="status">
        <span className={classes.state}>{text}</span>
        {view.kind === "failed" && online && (
          <Button variant="outline" compact onClick={onRetry}>
            {WEATHER.copy.tryAgain}
          </Button>
        )}
      </div>
    );
  }
  const { layer, step, first, last, shown, age } = view;
  return (
    <section className={classes.bar} aria-label={copy.weather}>
      <div className={classes.line}>
        <span className={classes.title}>
          {layer.label} <span className={classes.unit}>{layer.unit}</span>
        </span>
        <span className={classes.shown}>{shown}</span>
      </div>
      {step !== null && (
        <div className={classes.scrub}>
          <IconButton
            icon="scrollBack"
            label={copy.weatherEarlier}
            onClick={() => onStep(Math.max(first, step - 1))}
          />
          <input
            type="range"
            className={classes.range}
            aria-label={layer.label}
            aria-valuetext={shown}
            min={first}
            max={last}
            step={1}
            value={step}
            onChange={(e) => onStep(Number(e.currentTarget.value))}
          />
          <IconButton
            icon="scrollOn"
            label={copy.weatherLater}
            onClick={() => onStep(Math.min(last, step + 1))}
          />
        </div>
      )}
      <span className={classes.age}>{age}</span>
    </section>
  );
}
