// Choosing one of your places by NAME, for a field that points at a place.
//
// A `<select>` is the wrong control once the list is long: picking a place
// meant scrolling hundreds of options in a native dropdown, with no way in but
// the platform's type-to-find, which matches from the START of the primary name
// only (operator, 2026-09-17). A canyon known to its owner by an alternative
// name was unreachable that way.
//
// So: type, and see what matches. The matching is `placeMatchesSearch` — the
// same predicate the Places page's own search box uses, which covers `altNames`
// as well as `name` — rather than a third spelling of "does this place match".
//
// NOTHING IS FETCHED AND NOTHING IS GEOCODED. The caller already holds the
// places; this never reaches the network, which is what keeps it clear of the
// rule that a place name is not sent to a third party without being asked
// (root CLAUDE.md, and MapSearchBox's own "Search locations for…" gate).
import { useId, useMemo, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { placeMatchesSearch, type TPlace } from "../../placeUtils";
import { SearchField } from "../../ui";
import classes from "./PlacePicker.module.css";

/** Enough to choose from without becoming a list to scroll — the answer to too
 *  many matches is to type more, not to scroll further. */
const MAX_SUGGESTIONS = 8;

export default function PlacePicker({
  label,
  places,
  onSelect,
  disabled = false,
}: {
  /** The field's accessible name and its placeholder. */
  label: string;
  places: TPlace[];
  onSelect: (place: TPlace) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const trimmed = query.trim();
  const matches = useMemo(
    () =>
      trimmed === ""
        ? []
        : places.filter((place) => placeMatchesSearch(place, trimmed)).slice(0, MAX_SUGGESTIONS),
    [places, trimmed],
  );

  const open = focused && trimmed !== "";

  const choose = (place: TPlace) => {
    onSelect(place);
    setQuery("");
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  return (
    <div className={classes.root}>
      <SearchField
        ref={inputRef}
        label={label}
        placeholder={`${label}…`}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listId}-${matches[activeIndex]?.id}` : undefined
        }
        value={query}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (matches.length === 0) return;
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActiveIndex((current) => (current + step + matches.length) % matches.length);
          } else if (event.key === "Enter") {
            // One match and nothing highlighted is unambiguous, so Enter takes
            // it — the same shortcut the map's search box allows.
            const place = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined);
            if (!place) return;
            event.preventDefault();
            choose(place);
          } else if (event.key === "Escape") {
            // Escape clears, then leaves — never closes the panel behind it.
            event.stopPropagation();
            if (query) setQuery("");
            else inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <div className={classes.results}>
          <ul id={listId} role="listbox" aria-label={label} className={classes.list}>
            {matches.map((place, index) => (
              <li
                key={place.id}
                id={`${listId}-${place.id}`}
                role="option"
                aria-selected={index === activeIndex}
                className={classes.option}
                // pointerdown, not click: the input blurs first and the list
                // would be gone before a click could land.
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(place);
                }}
              >
                <MapPin size={16} aria-hidden className={classes.glyph} />
                <span className={classes.name}>{place.name}</span>
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p className={classes.status} role="status">
              No places match.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
