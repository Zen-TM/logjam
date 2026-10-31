import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  GAUGES,
  gaugeDisplayName,
  geocode,
  GEOCODE_MIN_QUERY_LENGTH,
  PLACE_REGISTRY_ATTRIBUTION,
  PLACE_SEARCH_DEBOUNCE_MS,
  PLACE_SEARCH_MIN_QUERY_LENGTH,
  placeResultDetail,
  searchLocationsLabel,
  type Gauge,
  type GeocodeResult,
  type PlaceResult,
} from "@logjam/shared";
import { searchPlaceRegistry, type TPlace } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./MapSearchBox.module.css";
import { Icon } from "../../ui";
import { useGauges } from "../gauges/useGauges";

const PLACE_RESULTS = 5;
const GAUGE_RESULTS = 3;
// Few enough that "Search locations for …" stays in view below them.
const REGISTRY_RESULTS = 8;

type Option =
  | { kind: "place"; id: string; place: TPlace; shared: boolean }
  | { kind: "gauge"; id: string; gauge: Gauge; name: string }
  | { kind: "registry"; id: string; result: PlaceResult }
  | { kind: "askLocations"; id: string }
  | { kind: "location"; id: string; result: GeocodeResult };

/**
 * Search places and locations, top-left over the map; `/` focuses it.
 *
 * Your own places match as you type, locally, and come first. Then river
 * gauges, also matched here, from the public file, fetched while the box has
 * focus whether or not the layer is on. Then the place registry, every named OpenStreetMap feature in NSW, through our API as you
 * type (ADR 0034). Street addresses come from the public geocoder, and ONLY
 * when asked for — the last option is "Search locations for …". A search box
 * that geocoded every keystroke would send the name of every canyon a user
 * looks up to a third party, and the places on this list are exactly the ones
 * not to publicise (MapSearchBox.test.tsx).
 *
 * A WAI-ARIA combobox: arrows move through the options, Enter chooses, Escape
 * clears and then leaves.
 */
export default function MapSearchBox({
  places,
  sharedPlaces,
  onSelectPlace,
  onSelectGauge,
  onSelectLocation,
}: {
  places: TPlace[];
  sharedPlaces: TPlace[];
  onSelectPlace: (place: TPlace) => void;
  onSelectGauge: (gauge: Gauge) => void;
  onSelectLocation: (lat: number, lon: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const { file: gaugeFile } = useGauges(focused);
  // The highlighted option by id, not position, so it stays on the same row
  // when an answer adds or removes rows around it.
  const [activeId, setActiveId] = useState<string | null>(null);
  const [locationQuery, setLocationQuery] = useState<string | null>(null);
  const [locations, setLocations] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last answer and the query it answers, kept while the next is on its
  // way so the list does not blink at every keystroke. `n` numbers the
  // answers, so a highlight on an old answer's row never lands on a new one.
  const [registry, setRegistry] = useState<{
    q: string;
    n: number;
    results: PlaceResult[];
    failure: string | null;
  } | null>(null);
  const answers = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const trimmed = query.trim();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const registryQuery =
    trimmed.length >= PLACE_SEARCH_MIN_QUERY_LENGTH ? trimmed : null;
  // An answer still fits while the query only grows ("Kat" while typing
  // "Kato"); a query that is not an extension of it is a different search.
  const answer =
    registry && registryQuery?.startsWith(registry.q) ? registry : null;
  useEffect(() => {
    if (registryQuery == null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const settle = (results: PlaceResult[], failure: string | null) =>
        setRegistry({
          q: registryQuery,
          n: ++answers.current,
          results,
          failure,
        });
      searchPlaceRegistry(registryQuery, REGISTRY_RESULTS, controller.signal)
        .then(({ results }) => settle(results, null))
        // A failure says so, in the API's own words; your places and the
        // geocoder row stay.
        .catch((err) => {
          if (!controller.signal.aborted)
            settle([], messageFromError(err, "Couldn't search locations."));
        });
    }, PLACE_SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [registryQuery]);

  useEffect(() => {
    if (locationQuery == null) return;
    const controller = new AbortController();
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
      ...places.filter(matches).map((place) => ({
        kind: "place" as const,
        id: `p-${place.id}`,
        place,
        shared: false,
      })),
      ...sharedPlaces.filter(matches).map((place) => ({
        kind: "place" as const,
        id: `s-${place.id}`,
        place,
        shared: true,
      })),
    ].slice(0, PLACE_RESULTS);
    const gaugeOptions: Option[] = (gaugeFile?.gauges ?? [])
      .flatMap((gauge) => {
        const name = gaugeDisplayName(gauge.name);
        return name.toLowerCase().includes(needle)
          ? [{ kind: "gauge" as const, id: `g-${gauge.id}`, gauge, name }]
          : [];
      })
      .slice(0, GAUGE_RESULTS);
    const ours: Option[] = [
      ...placeOptions,
      ...gaugeOptions,
      ...(answer?.results ?? []).map((result, index) => ({
        kind: "registry" as const,
        id: `r${answer?.n}-${index}`,
        result,
      })),
    ];
    if (trimmed.length < GEOCODE_MIN_QUERY_LENGTH) return ours;
    if (locationQuery === trimmed) {
      return [
        ...ours,
        ...locations.map((result, index) => ({
          kind: "location" as const,
          id: `l-${index}`,
          result,
        })),
      ];
    }
    return [...ours, { kind: "askLocations" as const, id: "ask" }];
  }, [
    trimmed,
    places,
    sharedPlaces,
    gaugeFile,
    answer,
    locationQuery,
    locations,
  ]);

  const open = focused && trimmed !== "";
  const activeIndex = options.findIndex((option) => option.id === activeId);
  const status = loading
    ? "Searching locations…"
    : (error ??
      answer?.failure ??
      (options.length === 0
        ? "No places match."
        : locationQuery === trimmed && locations.length === 0
          ? "No locations found."
          : null));

  const reset = () => {
    setQuery("");
    setActiveId(null);
    setLocationQuery(null);
    setLocations([]);
    setRegistry(null);
    setError(null);
  };

  const choose = (option: Option) => {
    if (option.kind === "askLocations") {
      // Offered only while the results are for another query, so this always
      // starts the search effect.
      setLocationQuery(trimmed);
      setLoading(true);
      setError(null);
      return;
    }
    if (option.kind === "place") onSelectPlace(option.place);
    else if (option.kind === "gauge") onSelectGauge(option.gauge);
    else onSelectLocation(option.result.lat, option.result.lon);
    reset();
    inputRef.current?.blur();
  };

  return (
    <div className={classes.root}>
      <div className={classes.field}>
        <Icon idea="search" size={18} aria-hidden className={classes.glyph} />
        <input
          ref={inputRef}
          className={classes.input}
          type="text"
          role="combobox"
          aria-label="Search places and locations"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0
              ? `${listId}-${options[activeIndex]?.id}`
              : undefined
          }
          placeholder="Search places and locations"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (options.length === 0) return;
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActiveId(
                options[(activeIndex + step + options.length) % options.length]
                  .id,
              );
            } else if (event.key === "Enter") {
              const option =
                options[activeIndex] ??
                (options.length === 1 ? options[0] : undefined);
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
          <ul
            id={listId}
            role="listbox"
            aria-label="Search results"
            className={classes.list}
          >
            {options.map((option, index) => {
              const icon =
                option.kind === "place"
                  ? option.shared
                    ? "friends"
                    : "place"
                  : option.kind === "gauge"
                    ? "gauge"
                    : "map";
              const label =
                option.kind === "place"
                  ? option.place.name
                  : option.kind === "gauge"
                    ? option.name
                    : option.kind === "registry"
                      ? option.result.name
                      : option.kind === "location"
                        ? option.result.displayName
                        : searchLocationsLabel(trimmed);
              const detail =
                option.kind === "registry"
                  ? placeResultDetail(option.result)
                  : option.kind === "gauge"
                    ? GAUGES.title
                    : null;
              return (
                <li
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-label={detail ? `${label}, ${detail}` : undefined}
                  aria-selected={index === activeIndex}
                  className={classes.option}
                  // pointerdown, not click: the input would blur first and
                  // close the list before a click could land.
                  onPointerDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  <Icon idea={icon} size={16} className={classes.optionGlyph} />
                  <span className={classes.optionLabel}>{label}</span>
                  {option.kind === "place" && option.shared && (
                    <span className={classes.optionMeta}>Shared</span>
                  )}
                  {detail && (
                    <span className={classes.optionMeta}>{detail}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {options.some(
            (option) =>
              option.kind === "registry" || option.kind === "location",
          ) && <p className={classes.credit}>{PLACE_REGISTRY_ATTRIBUTION}</p>}
          {status && (
            <p className={classes.status} role="status">
              {status}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
