// Waypoints: the marked points — a carpark, a campsite, an anchor, an exit.
//
// Mostly authored on the phone, where you are standing on the spot. The web's
// job is the desk work: finding one among hundreds, renaming it, filing it
// under canyons, and adding the ones you read off a guide rather than walked to.
//
// SEARCH AND TAGS, not a flat list. That is the one structural difference from
// RoutesPanel: routes are a handful of things you recognise by shape, while
// waypoints are many small things you arrive looking for one of. The narrowing
// logic is pure and tested (waypointFilter.ts).
//
// A waypoint linked to a canyon shared WITH you arrives read-only — the API
// refuses the write, so the UI must not offer it. Those are listed apart, as
// RoutesPanel does with shared routes.
//
// PRIVACY: coordinates render only on the EXPANDED row — the detail the user
// asked for by opening it — never on a collapsed list row. Same rule the mobile
// list follows (mobile/DESIGN.md §11).
import { useMemo, useState } from "react";
import { ChevronDown, Copy, MapPin, Plus, Share2, Trash2 } from "lucide-react";
import { WAYPOINT_TAG_SUGGESTIONS, waypointColor } from "@logjam/shared";

import classes from "./WaypointsPanel.module.css";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import { filterWaypoints, tagTallies } from "./waypointFilter";
import ShareDialog from "../../dialogs/ShareDialog";
import {
  getEntityShares,
  shareEntityWith,
  unshareEntityWith,
  type TCanyon,
  type TFriend,
  type TWaypoint,
} from "../../../canyonUtils";

type WaypointsPanelProps = {
  waypoints: TWaypoint[];
  loading: boolean;
  error: string | null;
  /** Refetch, for the load-failure banner. */
  onRetry: () => void;
  /** Owned + shared — for naming the canyons a waypoint is filed under. */
  canyons: TCanyon[];
  /** Friends an owned waypoint can be shared with. */
  friends: TFriend[];
  currentUserId: string | null;
  /** Which waypoint is expanded; lifted so a map marker click can open one. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onFlyTo: (waypoint: TWaypoint) => void;
  onUpdate: (
    id: string,
    data: Partial<{
      name: string;
      notes: string | null;
      tags: string[] | null;
      canyonIds: string[] | null;
    }>,
  ) => Promise<void>;
  onDelete: (waypoint: TWaypoint) => Promise<void>;
  /** Opens the add dialog — creation is an authoring step, so it owns a
   *  dialog rather than a form wedged into this browsing surface. */
  onAdd: () => void;
};

export default function WaypointsPanel({
  waypoints,
  loading,
  error,
  onRetry,
  canyons,
  friends,
  currentUserId,
  selectedId,
  onSelect,
  onFlyTo,
  onUpdate,
  onDelete,
  onAdd,
}: WaypointsPanelProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);

  const own = useMemo(
    () => waypoints.filter((waypoint) => waypoint.ownerId === currentUserId),
    [waypoints, currentUserId],
  );
  const shared = useMemo(
    () => waypoints.filter((waypoint) => waypoint.ownerId !== currentUserId),
    [waypoints, currentUserId],
  );

  // The rail tallies the whole library, not the filtered view: chips that
  // vanished as you typed would make the filter feel broken.
  const tallies = useMemo(() => tagTallies(waypoints), [waypoints]);
  const visibleOwn = filterWaypoints(own, query, tag);
  const visibleShared = filterWaypoints(shared, query, tag);
  const narrowed = query.trim() !== "" || tag !== null;

  const row = (waypoint: TWaypoint) => (
    <WaypointRow
      key={waypoint.id}
      waypoint={waypoint}
      canyons={canyons}
      friends={friends}
      expanded={waypoint.id === selectedId}
      onToggle={() => onSelect(waypoint.id === selectedId ? null : waypoint.id)}
      onFlyTo={() => onFlyTo(waypoint)}
      onUpdate={(data) => onUpdate(waypoint.id, data)}
      onDelete={() => onDelete(waypoint)}
      allWaypoints={waypoints}
    />
  );

  return (
    <div className={classes.root}>
      <button type="button" className={classes.addButton} onClick={onAdd}>
        <Plus size={14} /> Add a waypoint
      </button>

      <input
        className={classes.search}
        type="search"
        value={query}
        placeholder="Search name, notes, tags"
        aria-label="Search waypoints"
        onChange={(event) => setQuery(event.target.value)}
      />

      {tallies.length > 0 && (
        <div className={classes.tagRail}>
          <button
            type="button"
            className={tag === null ? classes.tagChipActive : classes.tagChip}
            onClick={() => setTag(null)}
          >
            All
          </button>
          {tallies.map(({ tag: name, count }) => (
            <button
              key={name}
              type="button"
              className={tag === name ? classes.tagChipActive : classes.tagChip}
              onClick={() => setTag(tag === name ? null : name)}
            >
              {name} <span className={classes.tagCount}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={onRetry} />}

      {loading && waypoints.length === 0 ? (
        <span className={classes.caption}>Loading…</span>
      ) : waypoints.length === 0 ? (
        <span className={classes.caption}>
          No waypoints yet. Drop one in Logjam GPS, or add one from coordinates
          above.
        </span>
      ) : (
        <>
          <div className={classes.sectionLabel}>
            My waypoints{narrowed ? ` · ${visibleOwn.length} of ${own.length}` : ""}
          </div>
          {visibleOwn.length === 0 ? (
            <span className={classes.caption}>Nothing matches that.</span>
          ) : (
            visibleOwn.map(row)
          )}

          {shared.length > 0 && (
            <>
              <div className={classes.divider} />
              <div className={classes.sectionLabel}>Shared with me</div>
              {visibleShared.length === 0 ? (
                <span className={classes.caption}>Nothing matches that.</span>
              ) : (
                visibleShared.map(row)
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── One row, collapsed or expanded ─────────────────────────────────────────

function WaypointRow({
  waypoint,
  canyons,
  friends,
  allWaypoints,
  expanded,
  onToggle,
  onFlyTo,
  onUpdate,
  onDelete,
}: {
  waypoint: TWaypoint;
  canyons: TCanyon[];
  friends: TFriend[];
  allWaypoints: TWaypoint[];
  expanded: boolean;
  onToggle: () => void;
  onFlyTo: () => void;
  onUpdate: (
    data: Partial<{
      name: string;
      notes: string | null;
      tags: string[] | null;
      canyonIds: string[] | null;
    }>,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}): React.JSX.Element {
  const readOnly = waypoint.syncRole === "shared";
  const color = waypointColor(waypoint);
  const position = `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`;
  const [copied, setCopied] = useState(false);

  return (
    <div className={classes.item}>
      <button
        type="button"
        className={classes.row}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <MapPin size={16} color={color} aria-hidden />
        <span className={classes.rowName}>{waypoint.name}</span>
        {waypoint.tags.length > 0 && (
          <span className={classes.rowMeta}>{waypoint.tags.join(" · ")}</span>
        )}
        <ChevronDown
          size={14}
          className={expanded ? classes.chevronOpen : classes.chevron}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className={classes.detail}>
          <div className={classes.detailRow}>
            {/* Clipboard is the user's own; nothing leaves the app. */}
            <button
              type="button"
              className={classes.coordButton}
              onClick={() => {
                void navigator.clipboard?.writeText(position);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              title="Copy coordinates"
            >
              <Copy size={12} /> {copied ? "Copied" : position}
            </button>
            <button type="button" className={classes.flyButton} onClick={onFlyTo}>
              Show on map
            </button>
          </div>

          {readOnly ? (
            <span className={classes.caption}>
              Shared with you through a canyon — only its owner can change it.
            </span>
          ) : (
            <EditableDetail
              waypoint={waypoint}
              canyons={canyons}
              friends={friends}
              allWaypoints={allWaypoints}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EditableDetail({
  waypoint,
  canyons,
  friends,
  allWaypoints,
  onUpdate,
  onDelete,
}: {
  waypoint: TWaypoint;
  canyons: TCanyon[];
  friends: TFriend[];
  allWaypoints: TWaypoint[];
  onUpdate: (
    data: Partial<{
      name: string;
      notes: string | null;
      tags: string[] | null;
      canyonIds: string[] | null;
    }>,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState(waypoint.name);
  const [notes, setNotes] = useState(waypoint.notes ?? "");
  const [newTag, setNewTag] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showShare, setShowShare] = useState(false);

  // Seed vocabulary ∪ every tag already in use — there is no tag registry, the
  // vocabulary IS the used values (same contract as trip types).
  const vocabulary = useMemo(() => {
    const used = new Set<string>(WAYPOINT_TAG_SUGGESTIONS);
    for (const row of allWaypoints) for (const t of row.tags) used.add(t);
    return [...used].sort((a, b) => a.localeCompare(b));
  }, [allWaypoints]);

  const ownedCanyons = canyons.filter((canyon) => canyon.ownerId === waypoint.ownerId);
  const linked = new Set(waypoint.canyonIds);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === waypoint.name) {
      setName(waypoint.name);
      return;
    }
    void onUpdate({ name: trimmed });
  };

  const commitNotes = () => {
    const trimmed = notes.trim();
    if (trimmed === (waypoint.notes ?? "")) return;
    void onUpdate({ notes: trimmed || null });
  };

  const toggleTag = (tag: string) => {
    void onUpdate({
      tags: waypoint.tags.includes(tag)
        ? waypoint.tags.filter((existing) => existing !== tag)
        : [...waypoint.tags, tag],
    });
  };

  const addTag = () => {
    const tag = newTag.trim();
    // The server rejects case-insensitive duplicates, so an existing tag is a
    // no-op rather than an error the user has to read.
    const already = waypoint.tags.some(
      (current) => current.toLowerCase() === tag.toLowerCase(),
    );
    if (tag && !already) void onUpdate({ tags: [...waypoint.tags, tag] });
    setNewTag("");
  };

  return (
    <>
      <label className={classes.fieldLabel}>
        Name
        <input
          className={classes.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
        />
      </label>

      <label className={classes.fieldLabel}>
        Notes
        <textarea
          className={classes.textarea}
          value={notes}
          rows={2}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={commitNotes}
        />
      </label>

      <div className={classes.fieldLabel}>Tags</div>
      <div className={classes.tagRail}>
        {vocabulary.map((tag) => (
          <button
            key={tag}
            type="button"
            className={
              waypoint.tags.includes(tag) ? classes.tagChipActive : classes.tagChip
            }
            onClick={() => toggleTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className={classes.inlineAdd}>
        <input
          className={classes.input}
          value={newTag}
          placeholder="New tag"
          aria-label="New tag"
          onChange={(event) => setNewTag(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addTag();
            }
          }}
        />
        <button type="button" className={classes.addTagButton} onClick={addTag}>
          Add
        </button>
      </div>

      <div className={classes.fieldLabel}>Linked canyons</div>
      {/* Linking to a canyon you have SHARED publishes this position to its
          recipients — a linked waypoint follows canyon-level media. The warning
          is on the label rather than behind a confirm because the checkbox list
          makes the state visible at a glance. */}
      <span className={classes.caption}>
        Anyone you share a canyon with can see the waypoints linked to it.
      </span>
      {ownedCanyons.length === 0 ? (
        <span className={classes.caption}>You have no canyons to link to.</span>
      ) : (
        <div className={classes.canyonList}>
          {ownedCanyons.map((canyon) => (
            <label key={canyon.id} className={classes.canyonRow}>
              <input
                type="checkbox"
                checked={linked.has(canyon.id)}
                onChange={() =>
                  void onUpdate({
                    canyonIds: linked.has(canyon.id)
                      ? waypoint.canyonIds.filter((id) => id !== canyon.id)
                      : [...waypoint.canyonIds, canyon.id],
                  })
                }
              />
              <span className={classes.canyonName}>{canyon.name}</span>
            </label>
          ))}
        </div>
      )}

      {confirmingDelete ? (
        <div className={classes.inlineAdd}>
          <button
            type="button"
            className={classes.deleteButton}
            onClick={() => void onDelete()}
          >
            <Trash2 size={12} /> Delete for good
          </button>
          <button
            type="button"
            className={classes.cancelButton}
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={classes.deleteButton}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 size={12} /> Delete waypoint
        </button>
      )}

      <button
        type="button"
        className={classes.cancelButton}
        onClick={() => setShowShare(true)}
      >
        <Share2 size={12} /> Share waypoint
      </button>

      <ShareDialog
        title={`Share ${waypoint.name}`}
        blurb={
          <>
            Recipients see this waypoint on their map and can export it. They
            cannot edit or delete it, and you can unshare at any time.
          </>
        }
        friends={friends}
        open={showShare}
        onClose={() => setShowShare(false)}
        listShares={() => getEntityShares("waypoint", waypoint.id)}
        share={(userId) => shareEntityWith("waypoint", waypoint.id, userId)}
        unshare={(userId) => unshareEntityWith("waypoint", waypoint.id, userId)}
      />
    </>
  );
}
