// Elevation profile for one line: height against distance travelled.
//
// A single-series area chart, drawn as inline SVG — no chart library, and none
// warranted for one filled path. Single series means no legend (the heading
// names it) and one axis; the fill takes the ROUTE's own colour, because on
// this map colour identifies the route, and the same route is that colour on
// the map beside this panel.
//
// The chart is never the only way to read the numbers: gain, loss and the
// min/max range are stated as text above it, so a reader who cannot resolve
// the plot still gets every figure.
import { useState } from "react";
import classes from "./ElevationProfile.module.css";
import { formatDistanceM, type ElevationSample } from "@logjam/shared";

/** Viewbox units. The SVG scales to its container; these only set the aspect. */
const WIDTH = 300;
const HEIGHT = 90;
/** Room under the plot, so the axis line isn't flush with the panel below. */
const AXIS_HEIGHT = 14;
/** Past this fraction of the width the readout flips to the left of its dot,
 *  or it would run off the panel. */
const LABEL_FLIP_AT = 0.6;

type ElevationProfileProps = {
  samples: ElevationSample[];
  minM: number | null;
  maxM: number | null;
  /** The route's map colour, so plot and map agree on identity. */
  color: string;
  /** Index into `samples` under the cursor, or null on leave. Lets the caller
   *  mark the same spot on the map — the samples are evenly spaced along the
   *  route (densifyLine), so an index is a position. */
  onHoverSampleChange?: (index: number | null) => void;
};

type PlotPoint = { x: number; y: number; index: number; sample: ElevationSample };

export default function ElevationProfile({
  samples,
  minM,
  maxM,
  color,
  onHoverSampleChange,
}: ElevationProfileProps): React.JSX.Element | null {
  const [hovered, setHovered] = useState<PlotPoint | null>(null);

  const known: PlotPoint[] = [];
  const totalM = samples[samples.length - 1]?.distanceM ?? 0;
  // A flat route would divide by zero; give it a nominal band so the line
  // lands mid-plot rather than at an edge.
  const span = (maxM ?? 0) - (minM ?? 0) || 1;
  const plotHeight = HEIGHT - AXIS_HEIGHT;
  samples.forEach((sample, index) => {
    if (sample.elevationM == null || minM == null) return;
    known.push({
      x: totalM === 0 ? 0 : (sample.distanceM / totalM) * WIDTH,
      y: plotHeight - ((sample.elevationM - minM) / span) * (plotHeight - 4) - 2,
      index,
      sample,
    });
  });

  // Two known heights is the minimum that makes a line; below that there is
  // nothing to plot and the text figures above already say so.
  if (known.length < 2 || minM == null || maxM == null) return null;

  const line = known.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `M0,${plotHeight} L${line.replace(/ /g, " L")} L${WIDTH},${plotHeight} Z`;

  const hover = (point: PlotPoint | null) => {
    setHovered(point);
    onHoverSampleChange?.(point?.index ?? null);
  };

  // Nearest sample to the pointer, in viewBox coordinates.
  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = known[0]!;
    for (const point of known) {
      if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
    }
    hover(nearest);
  };

  return (
    <div className={classes.root}>
      <svg
        className={classes.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Elevation profile: ${Math.round(minM)} to ${Math.round(maxM)} metres over ${formatDistanceM(totalM)}`}
        onPointerMove={handleMove}
        onPointerLeave={() => hover(null)}
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
          style={{ left: `${(hovered.x / WIDTH) * 100}%`, top: `${hovered.y}px` }}
          aria-hidden="true"
        >
          <span className={classes.markerDot} style={{ background: color }} />
          <span className={classes.markerLabel}>
            {formatDistanceM(hovered.sample.distanceM)} ·{" "}
            {Math.round(hovered.sample.elevationM!)} m
          </span>
        </div>
      )}
    </div>
  );
}
