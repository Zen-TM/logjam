import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MapPin, Search, Users, Globe } from "lucide-react";
import { geocode, type GeocodeResult } from "@logjam/shared";
import type { TPlace } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./MapSearchBox.module.css";

const PLACE_RESULTS = 5;
/** The geocoder wants a few characters to say anything useful. */
const LOCATION_MIN_CHARS = 3;

type Option =
  | { kind: "place"; id: string; place: TPlace; shared: boolean }
  | { kind: "askLocations"; id: string }
  | { kind: "location"; id: string; result: GeocodeResult };

/**
 * Search places and locations, top-left over the map; `/` focuses it.
 *
 * Your own places match as you type, locally. Locations (a town, a trailhead)
 * come from the public geocoder, and ONLY when asked for — the last option is
 * "Search locations for …". A search box that geocoded every keystroke would
 * send the name of every canyon a user looks up to a third party, and the
 * places on this list are exactly the ones not to publicise (root CLAUDE.md).
 *
 * A WAI-ARIA combobox: arrows move through the options, Enter chooses, Escape
 * clears and then leaves.
 */
export default function MapSearchBox({
  places,
  sharedPlaces,
  onSelectPlace,
  onSelectLocation,
}: {
  places: TPlace[];
  sharedPlaces: TPlace[];
  onSelectPlace: (place: TPlace) => void;
  onSelectLocation: (lat: number, lon: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [locationQuery, setLocationQuery] = useState<string | null>(null);
  const [locations, setLocations] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const trimmed = query.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (locationQuery == null) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    geocode(locationQuery, controller.signal)
      .then(setLocations)
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.error(err);
        setError(messageFromError(err, "Couldn't search locations."));
        setLocations([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [locationQuery]);

  const options = useMemo<Option[]>(() => {
    if (trimmed === "") return [];
    const needle = trimmed.toLowerCase();
    const matches = (place: TPlace) =>
      place.name.toLowerCase().includes(needle) ||
      place.altNames.some((alt) => alt.toLowerCase().includes(needle));
    const placeOptions: Option[] = [
      ...places.filter(matches).map((place) => ({ kind: "place" as const, id: `p-${place.id}`, place, shared: false })),
      ...sharedPlaces
        .filter(matches)
        .map((place) => ({ kind: "place" as const, id: `s-${place.id}`, place, shared: true })),
    ].slice(0, PLACE_RESULTS);
    if (trimmed.length < LOCATION_MIN_CHARS) return placeOptions;
    if (locationQuery === trimmed) {
      return [
        ...placeOptions,
        ...locations.map((result, index) => ({ kind: "location" as const, id: `l-${index}`, result })),
      ];
    }
    return [...placeOptions, { kind: "askLocations" as const, id: "ask" }];
  }, [trimmed, places, sharedPlaces, locationQuery, locations]);

  const open = focused && trimmed !== "";

  const reset = () => {
    setQuery("");
    setActiveIndex(-1);
    setLocationQuery(null);
    setLocations([]);
    setError(null);
  };

  const choose = (option: Option) => {
    if (option.kind === "askLocations") {
      setLocationQuery(trimmed);
      return;
    }
    if (option.kind === "place") onSelectPlace(option.place);
    else onSelectLocation(option.result.lat, option.result.lon);
    reset();
    inputRef.current?.blur();
  };

  return (
    <div className={classes.root}>
      <div className={classes.field}>
        <Search size={18} aria-hidden className={classes.glyph} />
        <input
          ref={inputRef}
          className={classes.input}
          type="text"
          role="combobox"
          aria-label="Search places and locations"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${options[activeIndex]?.id}` : undefined}
          placeholder="Search places and locations"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (options.length === 0) return;
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActiveIndex((current) => (current + step + options.length) % options.length);
            } else if (event.key === "Enter") {
              const option = options[activeIndex] ?? (options.length === 1 ? options[0] : undefined);
              if (option) {
                event.preventDefault();
                choose(option);
              }
            } else if (event.key === "Escape") {
              if (query) reset();
              else inputRef.current?.blur();
            }
          }}
        />
        {!focused && !query && (
          <kbd className={classes.kbd} aria-hidden>
            /
          </kbd>
        )}
      </div>
      {open && (
        <div className={classes.results}>
          <ul id={listId} role="listbox" aria-label="Search results" className={classes.list}>
            {options.map((option, index) => {
              const Icon = option.kind === "place" ? (option.shared ? Users : MapPin) : Globe;
              const label =
                option.kind === "place"
                  ? option.place.name
                  : option.kind === "location"
                    ? option.result.displayName
                    : `Search locations for “${trimmed}”`;
              return (
                <li
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={classes.option}
                  // pointerdown, not click: the input would blur first and
                  // close the list before a click could land.
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  <Icon size={16} aria-hidden className={classes.optionGlyph} />
                  <span className={classes.optionLabel}>{label}</span>
                  {option.kind === "place" && option.shared && <span className={classes.optionMeta}>Shared</span>}
                </li>
              );
            })}
          </ul>
          {(loading || error || (locationQuery === trimmed && !loading && locations.length === 0) || options.length === 0) && (
            <p className={classes.status} role="status">
              {loading
                ? "Searching locations…"
                : error
                  ? error
                  : options.length === 0
                    ? "No places match."
                    : "No locations found."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
