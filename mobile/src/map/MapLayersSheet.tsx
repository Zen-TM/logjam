// "Map layers" — everything that decides what the map draws, in one sheet with
// three tabs.
//
// The old version was one scroll through six stacked sections (basemap, offline,
// topo overlays, imports, GeoPDFs, tracks) of hand-rolled rows. It answered
// three unrelated questions in one column, so every one of them was a scroll
// away from the others. The tabs are those three questions:
//
//   Basemap  — what is the map made of?
//   Layers   — what is drawn on top of it?
//   Offline  — what works with no signal?
//
// Tabs rather than a second sheet, per DESIGN.md §6: one sheet, content swapped
// in place. The rail is pinned, so switching tabs never scrolls the list you are
// working in out of reach (§2).
//
// The Layers tab is one row PER KIND, not per file: a phone with thirty tracks
// and a dozen GeoPDFs made that tab a scroll of near-identical switches with no
// way to turn a whole kind off.
//
// EVERY KIND IS ALWAYS LISTED, including the ones with nothing in them, and the
// row's only trailing text is HOW MANY there are. A tab whose rows appeared and
// disappeared with the contents of the phone had no stable shape to learn — the
// switch you reached for last trip was somewhere else this trip, or gone. A
// zero is also an answer ("Tracks 0" says the record button has never been
// used), which is why it is rendered rather than hidden.
//
// NO PER-ITEM SWITCHES, and no disclosure — with one exception. Item visibility
// answered a question nobody asks on the map ("this GeoPDF but not that one"),
// and it cost every kind a chevron plus a stack of near-identical rows. The
// per-item verbs it carried (rename, delete, show on map) all live in Saved,
// which is where an inventory belongs. The exception is TOPO OVERLAYS: its
// "items" are five different LAYER TYPES (hillshade, vegetation, slope,
// contours, features) over an area, and drawing all five at once is three
// stacked rasters under a vector stack — a mess, not a map. So it keeps its
// disclosure, and sits LAST because it is the only row that opens.
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { BASEMAP_CATALOG } from "@logjam/shared";

import { assetHue, fontSize, fontWeight, spacing, theme } from "../theme";
import {
  BottomSheet,
  Row,
  SectionHeader,
  SegmentedControl,
  Toggle,
} from "../ui";
import { BasemapThumb } from "./BasemapThumb";
import { MOBILE_BASEMAPS } from "./basemapMeta";
import type { Connectivity } from "./connectivity";
import type { BasemapId, MapArtifact } from "./sourceResolver";

type Tab = "basemap" | "layers" | "offline";

/**
 * One switchable kind of thing drawn over the basemap.
 *
 * Composed by `MapScreen`, which is where every one of these counts and
 * switches already lives — passing eight kinds as twenty-four separate props
 * was most of this component's signature, and every new layer added three more.
 */
export type LayerToggleEntry = {
  key: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
  title: string;
  /** How many of this kind exist — NOT how many are visible. */
  count: number;
  /**
   * Live state worth a second line, and ONLY that: "2 not downloaded yet" on a
   * layer that is drawing less than its count. Never a description of what the
   * layer is (DESIGN.md §7) — those are what this tab just lost.
   */
  note?: string;
  value: boolean;
  onChange: (next: boolean) => void;
};

export type OverlayEntry = {
  /** "<jobId>/<layerName>" — the enabled-set key. */
  key: string;
  /** The LiDAR job this layer was rendered from. */
  areaId: string;
  areaLabel: string;
  /** TopoLayerName + its display label ("hillshade" / "Hillshade"). */
  layer: string;
  layerLabel: string;
};

export function MapLayersSheet({
  visible,
  onClose,
  connectivity,
  basemapId,
  onBasemapChange,
  artifacts,
  layers,
  overlays,
  enabledOverlays,
  onToggleOverlay,
  mutedAreas,
  onSetAreasMuted,
  showOverlays,
  onShowOverlaysChange,
  offlineOnly,
  onOfflineOnlyChange,
  onSaveArea,
  onOpenSaved,
}: {
  visible: boolean;
  onClose: () => void;
  connectivity: Connectivity;
  basemapId: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  artifacts: MapArtifact[];
  /** Every kind drawn over the basemap, in the order they are listed. */
  layers: LayerToggleEntry[];
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  /** Areas hidden wholesale — the "where" axis (see TopoOverlayList). */
  mutedAreas: ReadonlySet<string>;
  onSetAreasMuted: (areaIds: string[], muted: boolean) => void;
  /** Master switch for the topo band, so the row toggles with zero overlays
   *  and the layer/area picks underneath survive being switched off. */
  showOverlays: boolean;
  onShowOverlaysChange: (next: boolean) => void;
  offlineOnly: boolean;
  onOfflineOnlyChange: (next: boolean) => void;
  onSaveArea: () => void;
  onOpenSaved: (category: "region") => void;
}) {
  const [tab, setTab] = useState<Tab>("basemap");
  const online = connectivity === "online";

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Map layers">
      <View style={styles.rail}>
        <SegmentedControl
          options={[
            { value: "basemap", label: "Basemap" },
            { value: "layers", label: "Layers" },
            { value: "offline", label: "Offline" },
          ]}
          value={tab}
          onChange={(next) => setTab(next as Tab)}
        />
      </View>

      {tab === "basemap" ? (
        <BasemapTab
          basemapId={basemapId}
          onBasemapChange={onBasemapChange}
          online={online}
        />
      ) : null}

      {tab === "layers" ? (
        <LayersTab
          layers={layers}
          overlays={overlays}
          enabledOverlays={enabledOverlays}
          onToggleOverlay={onToggleOverlay}
          mutedAreas={mutedAreas}
          onSetAreasMuted={onSetAreasMuted}
          showOverlays={showOverlays}
          onShowOverlaysChange={onShowOverlaysChange}
        />
      ) : null}

      {tab === "offline" ? (
        <OfflineTab
          online={online}
          offlineOnly={offlineOnly}
          onOfflineOnlyChange={onOfflineOnlyChange}
          onSaveArea={onSaveArea}
          onOpenSaved={onOpenSaved}
          artifacts={artifacts}
          visible={visible}
        />
      ) : null}
    </BottomSheet>
  );
}

function BasemapTab({
  basemapId,
  onBasemapChange,
  online,
}: {
  basemapId: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  online: boolean;
}) {
  return (
    <View style={styles.body}>
      {/* Order and membership are MOBILE_BASEMAPS', not the catalog's — see
          basemapMeta.ts (the catalog also carries the web-only "osm" raster). */}
      {MOBILE_BASEMAPS.map((id) => {
        const entry = BASEMAP_CATALOG.find((candidate) => candidate.id === id);
        // Fail loudly: an id the catalog doesn't know is a programming error.
        if (!entry) throw new Error(`Unknown basemap id: ${id}`);
        // Online-only sources are unavailable offline BY POLICY (their tile
        // usage terms), which is a different thing from "not downloaded" — the
        // subtitle says which.
        const unavailable = !online && !entry.offlineCapable;
        const active = basemapId === id;
        return (
          <Row
            key={entry.id}
            leading={<BasemapThumb basemapId={id} />}
            title={entry.name}
            // Name + sample tile only. The blurbs were a sentence each on six
            // rows the user scrolls past every time, and the thumbnail already
            // says what the map looks like far better than the words did. The
            // subtitle now carries STATE and nothing else — which is why the
            // one that survives is the offline reason (DESIGN.md §10).
            subtitle={unavailable ? "Needs a connection" : undefined}
            disabled={unavailable}
            onPress={() => onBasemapChange(id)}
            // No "Showing" pill: the selection is a state of the row, not a
            // label on it. A filled check on an accent-lit card says it at a
            // glance, and a downloaded-region pill used to say "Offline" for a
            // basemap of which one small area is on the phone.
            right={
              active ? (
                <Feather name="check-circle" size={22} color={theme.accent} />
              ) : null
            }
            selected={active}
          />
        );
      })}
    </View>
  );
}

/**
 * One kind of layer: its glyph, how many exist, and a switch. No subtitle — the
 * count IS the state, and the sentence that used to sit there explained a thing
 * the user can see on the map behind the sheet (DESIGN.md §7).
 */
function LayerRow({ entry }: { entry: LayerToggleEntry }) {
  return (
    <Row
      icon={entry.icon}
      hue={entry.hue}
      title={entry.title}
      subtitle={entry.note}
      right={
        <View style={styles.trailing}>
          <Text style={styles.count}>{entry.count}</Text>
          <Toggle
            value={entry.value}
            onValueChange={entry.onChange}
            accessibilityLabel={`Show ${entry.title}`}
          />
        </View>
      }
    />
  );
}

function LayersTab({
  layers,
  overlays,
  enabledOverlays,
  onToggleOverlay,
  mutedAreas,
  onSetAreasMuted,
  showOverlays,
  onShowOverlaysChange,
}: {
  layers: LayerToggleEntry[];
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  mutedAreas: ReadonlySet<string>;
  onSetAreasMuted: (areaIds: string[], muted: boolean) => void;
  showOverlays: boolean;
  onShowOverlaysChange: (next: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandable = overlays.length > 0;

  return (
    <View style={styles.body}>
      {layers.map((entry) => (
        <LayerRow key={entry.key} entry={entry} />
      ))}

      {/* LAST, and the only row that opens — see the header. Its "items" are
          five layer TYPES over an area, not five files, so the choice between
          them is the map itself rather than an inventory question. */}
      <View style={styles.group}>
        <Row
          icon="layers"
          hue={assetHue.overlay}
          title="Topo overlays"
          onPress={expandable ? () => setExpanded((current) => !current) : undefined}
          accessibilityLabel={`Topo overlays — ${expanded ? "hide" : "show"} the list`}
          right={
            <View style={styles.trailing}>
              <Text style={styles.count}>{overlays.length}</Text>
              <Toggle
                value={showOverlays}
                onValueChange={onShowOverlaysChange}
                accessibilityLabel="Show topo overlays"
              />
              {expandable ? (
                <Feather
                  name={expanded ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={theme.textMuted}
                />
              ) : null}
            </View>
          }
        />
        {expanded ? (
          <View style={styles.groupItems}>
            <TopoOverlayList
              overlays={overlays}
              enabledOverlays={enabledOverlays}
              onToggleOverlay={onToggleOverlay}
              mutedAreas={mutedAreas}
              onSetAreasMuted={onSetAreasMuted}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The topo overlays, as two questions rather than a grid.
 *
 * A LiDAR job covers ONE area and renders the same handful of layers inside it
 * (hillshade, contours, features…), so the honest shape of this data is a
 * matrix — and a row per cell grows by five with every area saved. Nobody asks
 * it a per-cell question. They ask "contours, everywhere" or "not this area at
 * all", so those are the two sections:
 *
 *   LAYERS — what to draw. One switch per layer kind, across every area.
 *   AREAS  — where to draw it. One switch per area.
 *
 * The two are INDEPENDENT, not two views of one set: an overlay renders when
 * its layer is on AND its area is not muted. That is what makes each switch
 * mean one thing — muting an area hides it without destroying the layer picks
 * underneath, so unmuting brings back exactly what was showing. Deriving the
 * area switch from the cells instead would make it read "off" the moment any
 * single layer was off, which is the state the map is in almost all the time.
 *
 * Storage follows the same split: cells in `overlay_enabled` (registryDb),
 * muting in `topoAreaMuting.ts`.
 */
function TopoOverlayList({
  overlays,
  enabledOverlays,
  onToggleOverlay,
  mutedAreas,
  onSetAreasMuted,
}: {
  overlays: OverlayEntry[];
  enabledOverlays: ReadonlySet<string>;
  onToggleOverlay: (key: string) => void;
  mutedAreas: ReadonlySet<string>;
  onSetAreasMuted: (areaIds: string[], muted: boolean) => void;
}) {
  // Both groupings keep first-seen order, which is the order MapScreen composed
  // the jobs in (newest area first, TOPO_LAYERS order within one).
  const byLayer = useMemo(() => {
    const groups = new Map<string, { label: string; keys: string[] }>();
    for (const overlay of overlays) {
      const group = groups.get(overlay.layer) ?? {
        label: overlay.layerLabel,
        keys: [],
      };
      group.keys.push(overlay.key);
      groups.set(overlay.layer, group);
    }
    return [...groups];
  }, [overlays]);

  // Areas keep first-seen order too, and are deduped by id — one row per area,
  // however many layers it rendered.
  const areas = useMemo(() => {
    const seen = new Map<string, string>();
    for (const overlay of overlays) {
      if (!seen.has(overlay.areaId)) seen.set(overlay.areaId, overlay.areaLabel);
    }
    return [...seen];
  }, [overlays]);

  return (
    <>
      <SectionHeader label="Layers" />
      {byLayer.map(([layer, group]) => {
        const allOn = group.keys.every((key) => enabledOverlays.has(key));
        return (
          <ItemRow
            key={layer}
            hue={assetHue.overlay}
            title={group.label}
            visible={allOn}
            onVisibility={() => {
              for (const key of group.keys) {
                if (enabledOverlays.has(key) !== !allOn) onToggleOverlay(key);
              }
            }}
          />
        );
      })}

      <SectionHeader label="Areas" />
      {areas.map(([areaId, label]) => (
        <ItemRow
          key={areaId}
          hue={assetHue.overlay}
          title={label}
          visible={!mutedAreas.has(areaId)}
          onVisibility={() => onSetAreasMuted([areaId], !mutedAreas.has(areaId))}
        />
      ))}
    </>
  );
}

/** One line inside the topo group: a colour dot, its name, its switch. */
function ItemRow({
  hue,
  title,
  visible,
  onVisibility,
}: {
  hue: string;
  title: string;
  visible: boolean;
  onVisibility: () => void;
}) {
  return (
    <Row
      leading={<View style={[styles.dot, { backgroundColor: hue }]} />}
      title={title}
      style={styles.itemRow}
      right={
        <Toggle
          value={visible}
          onValueChange={onVisibility}
          accessibilityLabel={`Show ${title}`}
        />
      }
    />
  );
}


function OfflineTab({
  online,
  offlineOnly,
  onOfflineOnlyChange,
  onSaveArea,
  onOpenSaved,
  artifacts,
  visible,
}: {
  online: boolean;
  offlineOnly: boolean;
  onOfflineOnlyChange: (next: boolean) => void;
  onSaveArea: () => void;
  onOpenSaved: (category: "region") => void;
  artifacts: MapArtifact[];
  visible: boolean;
}) {
  const savedRegions = artifacts.filter(
    (artifact) => artifact.kind === "basemap-region",
  );
  const savedBytes = savedRegions.reduce(
    (sum, artifact) => sum + artifact.sizeBytes,
    0,
  );

  return (
    <View style={styles.body}>
      <Row
        icon="download-cloud"
        hue={assetHue.region}
        title="Save maps for offline use"
        subtitle={
          online
            ? "Pick an area and the maps"
            : "Needs a connection"
        }
        disabled={!online}
        onPress={onSaveArea}
      />
      <Row
        icon="cloud-off"
        hue={assetHue.region}
        title="Offline maps only"
        subtitle="Use only saved maps, even with signal"
        subtitleNumberOfLines={2}
        right={
          <Toggle
            value={offlineOnly}
            onValueChange={onOfflineOnlyChange}
            accessibilityLabel="Offline maps only"
          />
        }
      />

      <SectionHeader label="On this phone" />
      <Row
        icon="hard-drive"
        hue={assetHue.region}
        title={
          savedRegions.length === 1
            ? "1 saved area"
            : `${savedRegions.length} saved areas`
        }
        subtitle={
          savedRegions.length === 0
            ? "Download an area to use maps offline"
            : `${(savedBytes / 1024 / 1024).toFixed(0)} MB · rename or delete in Saved`
        }
        // Lands on Saved's Regions filter, not its everything-list: a pointer
        // that makes the user find the thing again is not a pointer.
        onPress={() => onOpenSaved("region")}
        right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The gap the list scrolls against, exactly as a screen's pinned rail owns
  // (DESIGN.md §2).
  rail: { paddingBottom: spacing(1.5) },
  body: { gap: spacing(1) },
  group: { gap: spacing(0.5) },
  // Items hang off their group's row, indented so the hierarchy is visible
  // without a second card colour.
  groupItems: { gap: spacing(0.5), paddingLeft: spacing(2) },
  itemRow: { minHeight: 48, paddingVertical: spacing(1) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  // Tabular so a column of counts lines up down the tab rather than shuffling
  // by a digit's width.
  count: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
});
