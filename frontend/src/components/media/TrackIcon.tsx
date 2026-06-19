// A simple zig-zag "route" glyph, tinted with the track's assigned colour.
// Used by the canyon track card, the trip-log track list, and as a colour
// legend. Falls back to currentColor when no colour is supplied.
export default function TrackIcon({
  color,
  size = 16,
}: {
  color?: string | null;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="2 17 8 7 14 17 22 7" />
    </svg>
  );
}
