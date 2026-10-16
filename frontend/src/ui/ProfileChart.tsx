// A profile chart: one value against position along a line. Height against
// distance for a route or a track, speed against time for a track. The twin of
// Logjam GPS's `ProfileChart`, read under a pointer instead of a finger.
//
// A single-series area chart, drawn as inline SVG — no chart library, and none
// warranted for one filled path. Single series means no legend (the heading
// names it) and one axis; the fill takes the LINE's own colour, because on
// this map colour identifies the line, and the same line is that colour on
// the map beside this panel.
//
// What x and the value MEAN is the series' business (`elevationSeries`,
// `speedSeries` in `@logjam/shared`): the chart only places them and hands
// them back to `formatX` and `formatValue` to be read out.
import { useEffect, useRef, useState } from "react";
import type { ProfileSeries } from "@logjam/shared";
import classes from "./ProfileChart.module.css";

/** Viewbox units. The SVG scales to its container; these only set the aspect. */
const WIDTH = 300;
const HEIGHT = 90;
/** Room under the plot, so the axis line isn't flush with the panel below. */
const AXIS_HEIGHT = 14;
/** Past this fraction of the width the readout flips to the left of its dot,
 *  or it would run off the panel. */
const LABEL_FLIP_AT = 0.6;

type ProfileChartProps = {
  series: ProfileSeries;
  /** Renders a value — the chart knows no units. */
  formatValue: (value: number) => string;
  /** Renders a position: metres along, or a time of day. */
  formatX: (x: number) => string;
  /** What the chart is, for a reader who cannot see it; the range is added. */
  label: string;
  /** The line's map colour, so plot and map agree on identity. */
  color: string;
  /** Index into `series.points` under the cursor, or null on leave, so the
   *  caller can mark the same spot on the map. */
  onHoverPointChange?: (index: number | null) => void;
};

type PlotPoint = {
  x: number;
  y: number;
  index: number;
  /** The series' own x and value, for the readout. */
  at: number;
  value: number;
};

export function ProfileChart({
  series,
  formatValue,
  formatX,
  label,
  color,
  onHoverPointChange,
}: ProfileChartProps): React.JSX.Element | null {
  const [hovered, setHovered] = useState<PlotPoint | null>(null);

  // A pointer emits moves far faster than the screen redraws, and each one
  // costs a scan of the samples, a re-render of this panel AND a GeoJSON write
  // to the map's hover source. Coalescing to one frame makes the cost per
  // FRAME rather than per EVENT, preventing drag lag. The pending position is
  // a ref so a superseded move is dropped rather than queued.
  //
  // ABOVE the early return below, with every other hook: a chart with too few
  // known values returns null, and a hook after that return runs on some
  // renders and not others.
  const frame = useRef<number | null>(null);
  const pendingX = useRef(0);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const { points, min, max } = series;
  const known: PlotPoint[] = [];
  const startX = points[0]?.x ?? 0;
  const totalX = (points[points.length - 1]?.x ?? 0) - startX;
  // A flat line would divide by zero; give it a nominal band so the line
  // lands mid-plot rather than at an edge.
  const span = (max ?? 0) - (min ?? 0) || 1;
  const plotHeight = HEIGHT - AXIS_HEIGHT;
  points.forEach((point, index) => {
    if (point.value == null || min == null) return;
    known.push({
      x: totalX === 0 ? 0 : ((point.x - startX) / totalX) * WIDTH,
      y: plotHeight - ((point.value - min) / span) * (plotHeight - 4) - 2,
      index,
      at: point.x,
      value: point.value,
    });
  });

  // Two known values is the minimum that makes a line; below that there is
  // nothing to plot and the figures around the chart already say so.
  if (known.length < 2 || min == null || max == null) return null;

  const line = known
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
  const area = `M0,${plotHeight} L${line.replace(/ /g, " L")} L${WIDTH},${plotHeight} Z`;

  const hover = (point: PlotPoint | null) => {
    setHovered(point);
    onHoverPointChange?.(point?.index ?? null);
  };

  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pendingX.current = ((event.clientX - rect.left) / rect.width) * WIDTH;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const x = pendingX.current;
      let nearest = known[0]!;
      for (const point of known) {
        if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
      }
      hover(nearest);
    });
  };

  const handleLeave = () => {
    // A queued frame would otherwise re-mark the spot just after the pointer
    // left, stranding the map's dot on a chart with no cursor on it.
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    hover(null);
  };

  return (
    <div className={classes.root}>
      <svg
        className={classes.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${formatValue(min)} to ${formatValue(max)}`}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
      >
        <path d={area} fill={color} className={classes.area} />
        <polyline
          points={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          // preserveAspectRatio="none" stretches the viewBox, which would
          // stretch the stroke with it; this keeps it 2px on screen.
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        <line
          x1={0}
          y1={plotHeight}
          x2={WIDTH}
          y2={plotHeight}
          className={classes.axis}
          vectorEffect="non-scaling-stroke"
        />
        {hovered && (
          <line
            x1={hovered.x}
            y1={0}
            x2={hovered.x}
            y2={plotHeight}
            className={classes.crosshair}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Dot and readout are HTML, not SVG: preserveAspectRatio="none" stretches
          the viewBox horizontally, which would leave a circle elliptical and the
          text squashed. The chart's height is fixed in CSS at HEIGHT px, so a
          viewBox y maps straight to a pixel offset. */}
      {hovered && (
        <div
          className={`${classes.marker} ${hovered.x > WIDTH * LABEL_FLIP_AT ? classes.markerFlipped : ""}`}
          style={{
            left: `${(hovered.x / WIDTH) * 100}%`,
            top: `${hovered.y}px`,
          }}
          aria-hidden="true"
        >
          {/* eslint-disable-next-line no-restricted-syntax -- the series colour is a runtime value of the chart, not a role */}
          <span className={classes.markerDot} style={{ background: color }} />
          {/* Value first, then where: "51 m at 3.7 km", "4.2 km/h at 2:41 pm".
              Two bare figures in axis order need the reader to know which axis
              is which, and a height and a distance are both metres. */}
          <span className={classes.markerLabel}>
            {formatValue(hovered.value)} at {formatX(hovered.at)}
          </span>
        </div>
      )}
    </div>
  );
}
