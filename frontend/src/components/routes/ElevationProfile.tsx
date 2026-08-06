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
/** Room under the plot for the distance labels. */
const AXIS_HEIGHT = 14;

type ElevationProfileProps = {
  samples: ElevationSample[];
  minM: number | null;
  maxM: number | null;
  /** The route's map colour, so plot and map agree on identity. */
  color: string;
};

type PlotPoint = { x: number; y: number; sample: ElevationSample };

export default function ElevationProfile({
  samples,
  minM,
  maxM,
  color,
}: ElevationProfileProps): React.JSX.Element | null {
  const [hovered, setHovered] = useState<PlotPoint | null>(null);

  const known = samples.filter((s) => s.elevationM != null);
  // Two known heights is the minimum that makes a line; below that there is
  // nothing to plot and the text figures above already say so.
  if (known.length < 2 || minM == null || maxM == null) return null;

  const totalM = samples[samples.length - 1]!.distanceM;
  // A flat route would divide by zero; give it a nominal band so the line
  // lands mid-plot rather than at an edge.
  const span = maxM - minM || 1;
  const plotHeight = HEIGHT - AXIS_HEIGHT;

  const plotted: PlotPoint[] = known.map((sample) => ({
    x: totalM === 0 ? 0 : (sample.distanceM / totalM) * WIDTH,
    y: plotHeight - ((sample.elevationM! - minM) / span) * (plotHeight - 4) - 2,
    sample,
  }));

  const line = plotted.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `M0,${plotHeight} L${line.replace(/ /g, " L")} L${WIDTH},${plotHeight} Z`;

  // Nearest sample to the pointer, in viewBox coordinates.
  const handleMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = plotted[0]!;
    for (const point of plotted) {
      if (Math.abs(point.x - x) < Math.abs(nearest.x - x)) nearest = point;
    }
    setHovered(nearest);
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
        onPointerLeave={() => setHovered(null)}
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
      <div className={classes.footer}>
        {hovered ? (
          <span>
            {formatDistanceM(hovered.sample.distanceM)} ·{" "}
            {Math.round(hovered.sample.elevationM!)} m
          </span>
        ) : (
          <>
            <span>0</span>
            <span>{formatDistanceM(totalM)}</span>
          </>
        )}
      </div>
    </div>
  );
}
