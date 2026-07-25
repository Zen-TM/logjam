import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { geocode, type GeocodeResult } from "@logjam/shared";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./MapSearchBox.module.css";

const DEBOUNCE_MS = 350;

/**
 * Place-name search shown during map-pick flows. On selecting a result it calls
 * `onSelect(lat, lon)` so the caller can recentre the map. See `geocode.ts` for
 * the privacy note — only the typed string leaves the app.
 */
export default function MapSearchBox({
  onSelect,
  shifted,
}: {
  onSelect: (lat: number, lon: number) => void;
  // Shift right (clear of an open sidebar panel), mirroring the attribution.
  shifted: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      geocode(trimmed, controller.signal)
        .then((found) => {
          setResults(found);
          setError(null);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.error(err);
          setError(messageFromError(err, "Couldn't search for that place."));
          setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const choose = (r: GeocodeResult) => {
    onSelect(r.lat, r.lon);
    setQuery("");
    setResults([]);
  };

  return (
    <div className={shifted ? `${classes.root} ${classes.shifted}` : classes.root}>
      <div className={classes.inputRow}>
        <Search size={15} className={classes.icon} />
        <input
          className={classes.input}
          type="text"
          placeholder="Search for a place…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search for a place to centre the map"
        />
        {query && (
          <button
            className={classes.clear}
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {(loading || error || results.length > 0) && (
        <div className={classes.results}>
          {loading && <div className={classes.status}>Searching…</div>}
          {error && <div className={classes.status}>{error}</div>}
          {!loading &&
            !error &&
            results.map((r, i) => (
              <button
                key={`${r.lat},${r.lon},${i}`}
                className={classes.resultItem}
                onClick={() => choose(r)}
              >
                {r.displayName}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
