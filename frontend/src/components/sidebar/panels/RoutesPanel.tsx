// Ways: every line the user has — routes they drew, tracks they recorded, files
// they imported, and the tracks on places friends shared with them.
//
// The page answers "what lines have I got?" (DESIGN.md §1). One pinned rail
// narrows it by kind, using Logjam GPS's own vocabulary for the first three
// (`CATEGORY_META` in mobile/src/saved/savedKeys.ts); what each kind IS, and why
// there is a fourth here, is `waysModel.ts`.
//
// Visibility toggles live in the Layers panel, with ONE deliberate exception
// kept from the panel this replaces: a standalone file has no Layers row of its
// own, so its switch here IS its map visibility.
import { useMemo, useState } from "react";
import {
  Activity,
  ChevronDown,
  Crosshair,
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
  mediaDisplayName,
  routeToGpx,
  routeToKml,
  type StandaloneFile,
} from "@logjam/shared";
import type { TFriend, TPlace, TRoute, PlaceTrack } from "../../../placeUtils";
import { ownerUsername } from "../../../placeUtils";
import { useStoredState } from "../../../useStoredState";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import {
  Button,
  ChipRail,
  Dialog,
  EmptyState,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SearchField,
  StatusPill,
  TextField,
  Toggle,
  type MenuEntry,
} from "../../../ui";
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
 *  gives it on its Saved tab (DESIGN.md §3). The fourth kind is every track on
 *  a place the user does not own, so it wears the reserved shared hue. */
const KIND_IDENTITY: Record<WayKind, { icon: LucideIcon; hue: string }> = {
  route: { icon: PenLine, hue: "var(--hue-route)" },
  track: { icon: Activity, hue: "var(--hue-track)" },
  import: { icon: FilePlus, hue: "var(--hue-import)" },
  place: { icon: MapPin, hue: "var(--hue-shared)" },
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
  shownStandaloneIds,
  onToggleStandaloneFile,
  onRenameStandaloneFile,
  onDeleteStandaloneFile,
  onFlyToStandaloneFile,
  places,
  onStartDrawingRoute,
  onOpenUnifiedImport,
  onSelectRoute,
  onOpenPlace,
}: {
  routes: TRoute[];
  /** False until the first fetches settle — an empty list before then is not
   *  "nothing yet", and saying so flashes a first-run screen at every user. */
  waysLoaded: boolean;
  /** Owner vs sharee: a route reached through a place share is listed, but it
   *  is not the user's own work. */
  currentUserId: string | null;
  /** To name the owner of something shared with the user. */
  friends: TFriend[];
  placeTracks: PlaceTrack[];
  /** The user's own imports and Logjam GPS recordings (metadata only). */
  standaloneFiles: StandaloneFile[];
  standaloneFilesError: string | null;
  /** Which of those are currently drawn on the map. */
  shownStandaloneIds: string[];
  onToggleStandaloneFile: (id: string) => void;
  onRenameStandaloneFile: (id: string, displayName: string) => void;
  onDeleteStandaloneFile: (file: StandaloneFile) => Promise<void>;
  /** Centre the map on a file's recorded extent. */
  onFlyToStandaloneFile: (file: StandaloneFile) => void;
  /** Owned + shared, for naming a track's place. */
  places: TPlace[];
  onStartDrawingRoute: () => void;
  onOpenUnifiedImport: () => void;
  onSelectRoute: (id: string) => void;
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
  const [pendingDelete, setPendingDelete] = useState<StandaloneFile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [renaming, setRenaming] = useState<StandaloneFile | null>(null);

  const fileById = useMemo(
    () => new Map(standaloneFiles.map((file) => [file.id, file])),
    [standaloneFiles],
  );
  const placeById = useMemo(() => new Map(places.map((place) => [place.id, place])), [places]);

  const ways = useMemo(
    () =>
      buildWays({
        routes,
        standaloneFiles,
        placeTracks,
        currentUserId,
        placeName: (id) => placeById.get(id)?.name ?? "Unnamed place",
      }),
    [routes, standaloneFiles, placeTracks, currentUserId, placeById],
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

  const routeById = useMemo(() => new Map(routes.map((route) => [route.id, route])), [routes]);

  /** What a row says under its title: how long it is, then where it lives. */
  const subtitleOf = (way: WayItem): string | undefined => {
    const place = way.placeId ? placeById.get(way.placeId)?.name : null;
    return (
      [
        way.distanceM != null ? formatDistanceM(way.distanceM) : null,
        // The place is named on rows that are not already titled by it.
        way.kind !== "place" && place ? place : null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined
    );
  };

  const exportEntries = (route: TRoute): MenuEntry[] => [
    {
      id: "gpx",
      label: "Export as GPX",
      icon: Download,
      onSelect: () =>
        downloadText(exportFilename(route.name, "gpx"), routeToGpx(route.name, route.points), GPX_MIME_TYPE),
    },
    {
      id: "kml",
      label: "Export as KML",
      icon: Download,
      onSelect: () =>
        downloadText(exportFilename(route.name, "kml"), routeToKml(route.name, route.points), KML_MIME_TYPE),
    },
  ];

  /** A row's verbs — the same list the thing offers wherever it is reached. */
  const entriesFor = (way: WayItem): MenuEntry[] => {
    if (way.kind === "route") {
      const route = routeById.get(way.id);
      if (!route) return [];
      return [
        { id: "open", label: "Open route", icon: RouteGlyph, onSelect: () => onSelectRoute(route.id) },
        ...(way.placeId
          ? [{ id: "place", label: "Open its place", icon: MapPin, onSelect: () => onOpenPlace(way.placeId!) }]
          : []),
        { id: "sep", separator: true },
        ...exportEntries(route),
      ];
    }
    // A place's track is titled by its place and identified by its media id,
    // so the verb goes to the place, which is the only thing there is to open.
    if (way.kind === "place" && way.placeId) {
      const placeId = way.placeId;
      return [{ id: "open", label: "Open place", icon: MapPin, onSelect: () => onOpenPlace(placeId) }];
    }
    const file = fileById.get(way.id);
    if (!file) return [];
    return [
      {
        id: "centre",
        label: "Centre the map here",
        icon: Crosshair,
        // Disabled rather than absent: the verb exists for this kind, it just
        // cannot run on a file whose extent was never recorded (DESIGN.md §7).
        disabled: file.metadata.bbox == null,
        onSelect: () => onFlyToStandaloneFile(file),
      },
      ...(file.linkedPlaceId
        ? [{ id: "place", label: "Open its place", icon: MapPin, onSelect: () => onOpenPlace(file.linkedPlaceId!) }]
        : []),
      { id: "rename", label: "Rename…", icon: Pencil, onSelect: () => setRenaming(file) },
      { id: "sep", separator: true },
      { id: "delete", label: "Delete", icon: Trash2, danger: true, onSelect: () => setPendingDelete(file) },
    ];
  };

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
        const file = way.kind === "track" || way.kind === "import" ? fileById.get(way.id) : null;
        // Only a route carries an owner id; a track on someone else's place is
        // shared without this page ever learning whose it is.
        const ownerId = way.kind === "route" ? routeById.get(way.id)?.ownerId : undefined;
        const owner = way.shared && ownerId ? ownerUsername(friends, ownerId) : null;
        return (
          <Row
            key={way.key}
            // Addressable from outside, as Places' rows are by `data-place-id`:
            // the kind is what a check on this page is usually about.
            data-way-key={way.key}
            data-way-kind={way.kind}
            className={classes.row}
            title={way.title}
            subtitle={subtitleOf(way)}
            description={WAY_KIND_LABELS[way.kind]}
            leading={<IconTile icon={identity.icon} hue={identity.hue} label={WAY_KIND_LABELS[way.kind]} />}
            onOpen={
              way.kind === "route"
                ? () => onSelectRoute(way.id)
                : way.placeId
                  ? () => onOpenPlace(way.placeId!)
                  : undefined
            }
            trailing={
              <>
                {way.shared && <StatusPill label={owner ? `From ${owner}` : "Shared"} tone="outline" />}
                {/* A standalone file has no Layers row of its own, so this
                    switch IS its map visibility. A file linked to a place is
                    already drawn by the place-tracks layer, so it has no
                    switch rather than one that appears to do nothing. */}
                {file && file.linkedPlaceId === null && (
                  <Toggle
                    label={`Show ${mediaDisplayName(file)} on the map`}
                    checked={shownStandaloneIds.includes(file.id)}
                    onChange={() => onToggleStandaloneFile(file.id)}
                  />
                )}
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

      <RenameWayDialog
        file={renaming}
        onSave={(name) => {
          if (renaming) onRenameStandaloneFile(renaming.id, name);
          setRenaming(null);
        }}
        onClose={() => setRenaming(null)}
      />

      <ConfirmDialog
        open={pendingDelete != null}
        title="Delete this file?"
        message="The file and its track are removed from your account, so they go from Logjam GPS and your other devices too. This can't be undone."
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={() => {
          if (!pendingDelete) return;
          setDeleteBusy(true);
          void onDeleteStandaloneFile(pendingDelete).finally(() => {
            setDeleteBusy(false);
            setPendingDelete(null);
          });
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

/**
 * Renaming a file, as a dialog rather than the inline field this page used to
 * carry: the body opens and ⋯ acts (DESIGN.md §5), and an always-live input on
 * every row committed a rename on blur — including the blur of clicking
 * somewhere else entirely. Logjam GPS asks in a form for the same reason.
 */
function RenameWayDialog({
  file,
  onSave,
  onClose,
}: {
  file: StandaloneFile | null;
  onSave: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  // Mounted on open, so a reopened dialog starts from the file it is naming now
  // and never from the last one's typing.
  return file ? <RenameWayForm key={file.id} file={file} onSave={onSave} onClose={onClose} /> : null;
}

function RenameWayForm({
  file,
  onSave,
  onClose,
}: {
  file: StandaloneFile;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const current = mediaDisplayName(file);
  const [name, setName] = useState(current);
  const trimmed = name.trim();

  return (
    <Dialog
      open
      title="Rename this file"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="filled"
            disabled={trimmed.length === 0 || trimmed === current}
            onClick={() => onSave(trimmed)}
          >
            Save
          </Button>
        </>
      }
    >
      <TextField
        label="File name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || trimmed.length === 0 || trimmed === current) return;
          event.preventDefault();
          onSave(trimmed);
        }}
        data-autofocus
      />
    </Dialog>
  );
}
