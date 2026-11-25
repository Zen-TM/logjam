import classes from "./ColourScale.module.css";

/**
 * A colour key drawn as one strip with its numbers evenly spaced under it, as
 * a weather map's scale is (the weather bar). The stops are opaque; between
 * two the strip mixes linearly, which is how the map mixes them too. Hidden
 * from a screen reader: a caller keeps the key in words elsewhere.
 */
export function ColourScale({
  stops,
}: {
  stops: readonly { label: string; colour: string }[];
}) {
  return (
    <span className={classes.scale} aria-hidden>
      <span
        className={classes.strip}
        style={{
          background: `linear-gradient(to right, ${stops.map((s) => s.colour).join(", ")})`,
        }}
      />
      <span className={classes.ticks}>
        {stops.map((s) => (
          <span key={s.label}>{s.label}</span>
        ))}
      </span>
    </span>
  );
}
