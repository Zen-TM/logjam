// Ways: every line the user has — routes they drew, tracks they recorded, files
// they imported, and the tracks on places friends shared with them.
//
// The page answers "what lines have I got?" (DESIGN.md §1). One pinned rail
// narrows it by kind, using Logjam GPS's own vocabulary (`CATEGORY_META` in
// mobile/src/saved/savedKeys.ts); what each kind IS is `waysModel.ts`.
//
// A row OPENS — whatever kind it is — and its ⋯ acts. Which verbs it offers is
// `wayActions.ts`, the same list the way's own page offers: a row shows the
// full list and hands the ones needing a form (share, rename, delete) to the
// page with that verb armed, so the two surfaces can never offer different
// things. Nothing here renames or deletes in place any more.
import { useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  CopyPlus,
  Download,
  EllipsisVertical,
  FilePlus,
  Filter,
  MapPin,
  PenLine,
  Pencil,
  Plus,
  Route as RouteGlyph,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  exportFilename,
  formatDistanceM,
  GPX_MIME_TYPE,
  KML_MIME_TYPE,
  routeToGpx,
  routeToKml,
  type StandaloneFile,
} from "@logjam/shared";
import type { TFriend, TPlace, TRoute, PlaceTrack } from "../../../placeUtils";
import { ownerUsername } from "../../../placeUtils";
import { useStoredState } from "../../../useStoredState";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import {
  Button,
  ChipRail,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SearchField,
  StatusPill,
  type MenuEntry,
} from "../../../ui";
import { wayVerbs, type WayVerbId } from "./wayActions";
import {
  buildWays,
  WAY_KIND_LABELS,
  WAY_KINDS,
  wayKindCounts,
  wayMatchesSearch,
  type WayItem,
  type WayKind,
} from "./waysModel";
import classes from "./RoutesPanel.module.css";

const ANY_KIND = "any";

/** A kind's glyph and hue, from `ASSET_HUES` — the same identity Logjam GPS
 *  gives it on its Saved tab (DESIGN.md §3). */
const KIND_IDENTITY: Record<WayKind, { icon: LucideIcon; hue: string }> = {
  route: { icon: PenLine, hue: "var(--hue-route)" },
  track: { icon: Activity, hue: "var(--hue-track)" },
  import: { icon: FilePlus, hue: "var(--hue-import)" },
};

const VERB_ICON: Partial<Record<WayVerbId, LucideIcon>> = {
  open: RouteGlyph,
  openPlace: MapPin,
  edit: Pencil,
  copy: CopyPlus,
  copyAndRemove: CopyPlus,
  share: Share2,
  exportGpx: Download,
  exportKml: Download,
  rename: Pencil,
  // Not a bin: this drops the caller's own share and the owner keeps their row.
  removeShare: X,
  delete: Trash2,
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Export never touches the server — a route's geometry is already here. */
function downloadText(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RoutesPanel({
  routes,
  waysLoaded,
  currentUserId,
  friends,
  placeTracks,
  standaloneFiles,
  standaloneFilesError,
  places,
  sharedPlaces,
  onStartDrawingRoute,
  onOpenUnifiedImport,
  onOpenWay,
  onOpenPlace,
}: {
  routes: TRoute[];
  /** False until the first fetches settle — an empty list before then is not
   *  "nothing yet", and saying so flashes a first-run screen at every user. */
  waysLoaded: boolean;
  currentUserId: string | null;
  /** To name the owner of something shared with the user. */
  friends: TFriend[];
  placeTracks: PlaceTrack[];
  standaloneFiles: StandaloneFile[];
  standaloneFilesError: string | null;
  /** Owned + shared, for naming the place a way belongs to. */
  places: TPlace[];
  /** The places shared WITH the user — what tells a route shared on its own
   *  from one seen through somebody's place, and so which verbs it offers
   *  (`WayItem.viaPlace`). */
  sharedPlaces: TPlace[];
  onStartDrawingRoute: () => void;
  onOpenUnifiedImport: () => void;
  /**
   * Open a way's own page, which also centres the map on it. `verb` arms one
   * of that page's actions — how a row offers Share, Rename and Delete without
   * hosting a second copy of each form.
   */
  onOpenWay: (way: WayItem, verb?: WayVerbId) => void;
  onOpenPlace: (placeId: string) => void;
}): React.JSX.Element {
  // Session-scoped, like every other page's search: a query remembered for a
  // month reads as "my lines are missing" rather than as a favour.
  const [query, setQuery] = useStoredState("logjam.waySearch", "", sessionStorage);
  const [searchOpen, setSearchOpen] = useState(query !== "");
  const [kind, setKind] = useStoredState<WayKind | typeof ANY_KIND>(
    "logjam.wayKind",
    ANY_KIND,
    sessionStorage,
  );

  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);
  const routeById = useMemo(() => new Map(routes.map((route) => [route.id, route])), [routes]);

  const sharedPlaceIds = useMemo(
    () => new Set(sharedPlaces.map((place) => place.id)),
    [sharedPlaces],
  );

  const ways = useMemo(
    () => buildWays({ routes, standaloneFiles, placeTracks, currentUserId, sharedPlaceIds }),
    [routes, standaloneFiles, placeTracks, currentUserId, sharedPlaceIds],
  );

  const searched = useMemo(
    () => ways.filter((way) => wayMatchesSearch(way, query)),
    [ways, query],
  );
  const visible = useMemo(
    () => (kind === ANY_KIND ? searched : searched.filter((way) => way.kind === kind)),
    [searched, kind],
  );
  // Counts apply every axis but the rail's own, so a chip answers "how many
  // would I get if I pressed this" (DESIGN.md §3).
  const counts = useMemo(() => wayKindCounts(searched), [searched]);

  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };

  /** What a row says under its title: how long it is, then where it lives. */
  const subtitleOf = (way: WayItem): string | undefined => {
    const place = way.placeId ? placeById.get(way.placeId)?.name : null;
    return (
      [way.distanceM != null ? formatDistanceM(way.distanceM) : null, place ?? null]
        .filter(Boolean)
        .join(" · ") || undefined
    );
  };

  const exportRoute = (way: WayItem, format: "gpx" | "kml") => {
    const route = routeById.get(way.id);
    if (!route) return;
    downloadText(
      exportFilename(route.name, format),
      format === "gpx" ? routeToGpx(route.name, route.points) : routeToKml(route.name, route.points),
      format === "gpx" ? GPX_MIME_TYPE : KML_MIME_TYPE,
    );
  };

  /**
   * A row's ⋯ — the SAME list the way's page offers (wayActions.ts).
   *
   * Verbs that act on the spot run here; the ones that need a form go to the
   * page with the verb armed. Which is which is invisible to the user, and it
   * is what lets one list serve both surfaces.
   */
  const entriesFor = (way: WayItem): MenuEntry[] =>
    wayVerbs(way, "row").flatMap((verb, index, all) => {
      const onSelect = () => {
        switch (verb.id) {
          case "open":
            onOpenWay(way);
            return;
          case "openPlace":
            if (way.placeId) onOpenPlace(way.placeId);
            return;
          case "exportGpx":
            exportRoute(way, "gpx");
            return;
          case "exportKml":
            exportRoute(way, "kml");
            return;
          default:
            onOpenWay(way, verb.id);
        }
      };
      const item: MenuEntry = {
        id: verb.id,
        label: verb.label,
        ...(VERB_ICON[verb.id] ? { icon: VERB_ICON[verb.id] } : {}),
        ...(verb.danger ? { danger: true } : {}),
        onSelect,
      };
      // A rule above the verbs that END the user's relationship with the way,
      // so the last step of parting with something is never adjacent to an
      // ordinary one. Not keyed on `danger`: Remove belongs below the rule and
      // destroys nothing (wayActions.ts).
      return verb.separated && index > 0 && !all[index - 1].separated
        ? [{ id: `${verb.id}-sep`, separator: true } as MenuEntry, item]
        : [item];
    });

  const hero = (
    <Hero
      title={!waysLoaded ? "Ways" : ways.length === 0 ? "No lines yet" : plural(ways.length, "line")}
      actions={
        searchOpen ? (
          <IconButton icon={X} label="Close search" onClick={closeSearch} />
        ) : (
          <>
            <IconButton
              icon={Search}
              label="Search ways"
              tone={query ? "filled" : "default"}
              aria-expanded={false}
              onClick={() => setSearchOpen(true)}
            />
            <Menu
              label="Add a way"
              placement="bottom-end"
              entries={[
                { id: "draw", label: "Draw a route", icon: PenLine, onSelect: onStartDrawingRoute },
                { id: "import", label: "Import from file", icon: Upload, onSelect: onOpenUnifiedImport },
              ]}
              trigger={(props) => (
                <Button {...props} compact variant="filled" icon={Plus} trailingIcon={ChevronDown}>
                  Add
                </Button>
              )}
            />
          </>
        )
      }
    >
      {searchOpen && (
        <SearchField
          label="Search by name"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            closeSearch();
          }}
        />
      )}
    </Hero>
  );

  const rails = (
    <div className={classes.rails}>
      <ChipRail
        label="Kind"
        options={[
          { value: ANY_KIND, label: "All", count: counts.all },
          ...WAY_KINDS.map((each) => ({
            value: each,
            label: WAY_KIND_LABELS[each],
            count: counts[each],
            icon: KIND_IDENTITY[each].icon,
            hue: KIND_IDENTITY[each].hue,
            disabled: counts[each] === 0 && kind !== each,
          })),
        ]}
        value={kind}
        onChange={(next) => setKind(next as WayKind | typeof ANY_KIND)}
      />
    </div>
  );

  const list = !waysLoaded ? (
    <div className={classes.emptyArea} role="status">
      <p className={classes.loading}>Loading your ways…</p>
    </div>
  ) : ways.length === 0 ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={RouteGlyph}
        title="No lines yet"
        body="Draw a route on the map, or bring a GPX or KML in from another app. Tracks you record in Logjam GPS appear here too."
        actions={
          <>
            <Button compact variant="filled" icon={PenLine} onClick={onStartDrawingRoute}>
              Draw a route
            </Button>
            <Button compact variant="outline" icon={Upload} onClick={onOpenUnifiedImport}>
              Import
            </Button>
          </>
        }
      />
    </div>
  ) : visible.length === 0 ? (
    <div className={classes.emptyArea}>
      <EmptyState
        icon={Filter}
        title="No ways match"
        body="Nothing matches your search and the kind you picked."
        actions={
          <Button
            compact
            variant="outline"
            onClick={() => {
              setQuery("");
              setKind(ANY_KIND);
            }}
          >
            Clear filters
          </Button>
        }
      />
    </div>
  ) : (
    <div className={classes.list}>
      {visible.map((way) => {
        const identity = KIND_IDENTITY[way.kind];
        const ownerId = way.kind === "route" ? routeById.get(way.id)?.ownerId : undefined;
        const owner = way.shared && ownerId ? ownerUsername(friends, ownerId) : null;
        return (
          <Row
            key={way.key}
            data-way-key={way.key}
            data-way-kind={way.kind}
            className={classes.row}
            title={way.title}
            subtitle={subtitleOf(way)}
            description={WAY_KIND_LABELS[way.kind]}
            leading={<IconTile icon={identity.icon} hue={identity.hue} label={WAY_KIND_LABELS[way.kind]} />}
            // Every kind opens, and opening centres the map on it.
            onOpen={() => onOpenWay(way)}
            trailing={
              <>
                {way.shared && <StatusPill label={owner ? `From ${owner}` : "Shared"} tone="outline" />}
                <Menu
                  label={`Actions for ${way.title}`}
                  title={way.title}
                  placement="right-start"
                  entries={entriesFor(way)}
                  trigger={(props) => (
                    <IconButton {...props} icon={EllipsisVertical} label={`Actions for ${way.title}`} />
                  )}
                />
              </>
            }
          />
        );
      })}
    </div>
  );

  return (
    <div className={classes.root}>
      {hero}
      {rails}
      {standaloneFilesError && (
        <div className={classes.banner}>
          <ErrorBanner message={standaloneFilesError} />
        </div>
      )}
      {list}
    </div>
  );
}
