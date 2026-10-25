// "Map layers" — everything that decides what the map draws, in one sheet of
// tabs.
//
// The tabs answer distinct questions without scrolling through a
// stack of unrelated sections:
//
//   Basemap  — what is the map made of?
//   Terrain  — what shape is the ground?
//   Layers   — what is drawn on top of it?
//   Offline  — what works with no signal?
//
// Tabs rather than a second sheet, per DESIGN.md: one sheet, content swapped
// in place. The rail is pinned, so switching tabs never scrolls the list you are
// working in out of reach (DESIGN.md).
//
// The Layers tab is one row PER KIND, not per file: listing every track and
// GeoPDF individually would produce a scroll of near-identical switches with no
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
// answers a question nobody asks on the map ("this GeoPDF but not that one"),
// and would cost every kind a chevron plus a stack of near-identical rows.
// Per-item verbs (rename, delete, show on map) live in Saved, which is where an
// inventory belongs. The exception is TOPO OVERLAYS: its
// "items" are five different LAYER TYPES (hillshade, vegetation, slope,
// contours, features) over an area, and drawing all five at once is three
// stacked rasters under a vector stack — a mess, not a map. So it keeps its
// disclosure, and sits LAST because it is the only row that opens.
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  BASEMAP_CATALOG,
  contractSectionKeys,
  MAP_LAYERS,
  MAP_OVERLAYS,
  MAP_TERRAIN,
  TERRAIN_LAYER_KEYS,
  type SectionKeysOn,
  type TerrainSwitchKey,
} from "@logjam/shared";

import {
  spacing,
  makeStyles,
  useTheme,
  useHues,
  controlSize,
  opacity,
} from "../theme";
import {
  BottomSheet,
  Row,
  SectionHeader,
  ChipRail,
  Toggle,
  Icon,
  type Glyph,
  SwitchRow,
} from "../ui";
import { BasemapThumb } from "./BasemapThumb";
import { MOBILE_BASEMAPS } from "./basemapMeta";
import type { Connectivity } from "./connectivity";
import { terrainSwitch } from "./terrainSwitches";
import type { BasemapId, MapArtifact } from "./sourceResolver";

type Tab = SectionKeysOn<typeof MAP_LAYERS, "gps">;

const copy = MAP_LAYERS.copy;

const TAB_LABEL: Record<Tab, string> = {
  basemap: copy.tabBasemap,
  terrain: copy.tabTerrain,
  overlays: copy.tabOverlays,
  offline: copy.tabOffline,
};

/**
 * One switchable kind of thing drawn over the basemap.
 *
 * Composed by `MapScreen`, which is where every one of these counts and
 * switches already lives — passing eight kinds as twenty-four separate props
 * was most of this component's signature, and every new layer added three more.
 */
export type LayerToggleEntry = {
  key: string;
  icon: Glyph;
  hue: string;
  title: string;
  /** How many of this kind exist — NOT how many are visible. */
  count: number;
  /**
   * Live state worth a second line, and ONLY that: "2 not downloaded yet" on a
   * layer that is drawing less than its count. Never a description of what the
   * layer is (DESIGN.md).
   */
  note?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** Dimmed and untappable because something above it already decided. A row
   *  whose switch moves while the map draws nothing is a lie. */
  inert?: boolean;
  /**
   * Sub-rows under a master, for a layer whose contents are a vocabulary
   * rather than one thing — the place TYPES. Same master-plus-children shape
   * the topo band already uses, so this is not a new pattern: the master row
   * opens, its switch is "this layer at all", and each child is one type.
   *
   * Absent on a layer with nothing to break down, which is most of them.
   */
  children?: {
    key: string;
    title: string;
    hue: string;
    count: number;
    value: boolean;
    onChange: (next: boolean) => void;
  }[];
};

export function MapLayersSheet({
  visible,
  onClose,
  connectivity,
  basemapId,
  onBasemapChange,
  terrainLayers,
  onTerrainLayerChange,
  artifacts,
  layers,
  hasVegetation,
  offlineOnly,
  onOfflineOnlyChange,
  onSaveArea,
  onOpenSaved,
  onImportFile,
}: {
  visible: boolean;
  onClose: () => void;
  connectivity: Connectivity;
  basemapId: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  terrainLayers: Readonly<Record<TerrainSwitchKey, boolean>>;
  onTerrainLayerChange: (key: TerrainSwitchKey, on: boolean) => void;
  artifacts: MapArtifact[];
  /** Every kind drawn over the basemap, in the order they are listed. */
  layers: LayerToggleEntry[];
  /** Whether a sharpened area has a vegetation layer to switch. */
  hasVegetation: boolean;
  offlineOnly: boolean;
  onOfflineOnlyChange: (next: boolean) => void;
  onSaveArea: () => void;
  onOpenSaved: (category: "region") => void;
  /** The overlays list ends with the way to add one: the existing importer. */
  onImportFile: () => void;
}) {
  const styles = useStyles();

  const [tab, setTab] = useState<Tab>("basemap");
  const online = connectivity === "online";

  // Exhaustive by type: a tab the contract names and this sheet does not
  // draw, or the reverse, fails `tsc` (`MAP_LAYERS`, shared/src/contracts).
  const panes: Record<Tab, () => ReactNode> = {
    basemap: () => (
      <BasemapTab
        basemapId={basemapId}
        onBasemapChange={onBasemapChange}
        online={online}
      />
    ),
    terrain: () => (
      <TerrainTab
        layers={terrainLayers}
        onChange={onTerrainLayerChange}
        basemapId={basemapId}
        online={online}
        artifacts={artifacts}
        hasVegetation={hasVegetation}
      />
    ),
    overlays: () => <LayersTab layers={layers} onImportFile={onImportFile} />,
    offline: () => (
      <OfflineTab
        online={online}
        offlineOnly={offlineOnly}
        onOfflineOnlyChange={onOfflineOnlyChange}
        onSaveArea={onSaveArea}
        onOpenSaved={onOpenSaved}
        artifacts={artifacts}
        visible={visible}
      />
    ),
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={MAP_LAYERS.title}>
      <View style={styles.rail}>
        <ChipRail
          options={contractSectionKeys(MAP_LAYERS, "gps").map((key) => ({
            value: key,
            label: TAB_LABEL[key],
          }))}
          value={tab}
          onChange={(next) => setTab(next as Tab)}
        />
      </View>

      {panes[tab]()}
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
  const theme = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.body}>
      {/* Order and membership are MOBILE_BASEMAPS', not the catalog's — see
          basemapMeta.ts (the catalog also carries the Logjam Web-only "osm"
          raster). */}
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
          <Fragment key={entry.id}>
            <Row
              leading={<BasemapThumb basemapId={id} />}
              title={entry.name}
              // Name + sample tile only. The thumbnail already shows what the
              // map looks like without long text blurbs. The subtitle carries
              // STATE and nothing else — the offline reason when unavailable
              // (DESIGN.md).
              subtitle={unavailable ? "Needs a connection" : undefined}
              disabled={unavailable}
              onPress={() => onBasemapChange(id)}
              // No "Showing" pill: the selection is a state of the row, not a
              // label on it. A filled check on an accent-lit card says it at a
              // glance, avoiding an ambiguous "Offline" pill for a basemap of
              // which only one small area is on the phone.
              right={
                active ? (
                  <Icon idea="success" size={22} color={theme.accent} />
                ) : null
              }
              selected={active}
            />
          </Fragment>
        );
      })}
    </View>
  );
}

/**
 * The Terrain group: one switch per layer, in `MAP_TERRAIN`'s order. The
 * slope's bands are the account's, chosen on Logjam Web.
 */
function TerrainTab({
  layers,
  onChange,
  basemapId,
  online,
  artifacts,
  hasVegetation,
}: {
  layers: Readonly<Record<TerrainSwitchKey, boolean>>;
  onChange: (key: TerrainSwitchKey, on: boolean) => void;
  basemapId: BasemapId;
  online: boolean;
  /** What is saved on this phone: offline, a layer needs a clip of itself. */
  artifacts: readonly MapArtifact[];
  /** A sharpened area has a vegetation layer to switch. */
  hasVegetation: boolean;
}) {
  const styles = useStyles();
  const rows = {
    ...Object.fromEntries(
      TERRAIN_LAYER_KEYS.map((key) => {
        const state = terrainSwitch(
          key,
          layers[key],
          basemapId,
          online,
          artifacts,
        );
        return [
          key,
          <SwitchRow
            key={key}
            title={MAP_TERRAIN.copy[key]}
            description={state.reason}
            disabled={state.disabled}
            style={styles.itemRow}
            checked={state.checked}
            onChange={(on) => onChange(key, on)}
          />,
        ];
      }),
    ),
    vegetation: hasVegetation ? (
      <SwitchRow
        key="vegetation"
        title={MAP_TERRAIN.copy.vegetation}
        description={MAP_TERRAIN.copy.vegetationHint}
        style={styles.itemRow}
        checked={layers.vegetation}
        onChange={(on) => onChange("vegetation", on)}
      />
    ) : null,
  } as Record<SectionKeysOn<typeof MAP_TERRAIN, "gps">, ReactNode>;
  return (
    <View style={styles.body}>
      {contractSectionKeys(MAP_TERRAIN, "gps").map((key) => rows[key])}
    </View>
  );
}

/**
 * One kind of layer: its glyph, how many exist, and a switch. No subtitle — the
 * count IS the state, avoiding explaining things the user can see on the map
 * behind the sheet (DESIGN.md).
 */
function LayerRow({ entry }: { entry: LayerToggleEntry }) {
  const theme = useTheme();
  const styles = useStyles();

  const [expanded, setExpanded] = useState(false);
  const expandable = (entry.children?.length ?? 0) > 0;

  if (expandable) {
    return (
      <View style={styles.group}>
        <Row
          icon={entry.icon}
          hue={entry.hue}
          title={entry.title}
          subtitle={entry.note}
          onPress={() => setExpanded((current) => !current)}
          accessibilityLabel={`${entry.title} — ${expanded ? "hide" : "show"} the list`}
          right={
            <View style={styles.trailing}>
              <Text style={styles.count}>{entry.count}</Text>
              <Toggle
                checked={entry.value}
                onChange={entry.onChange}
                accessibilityLabel={`Show ${entry.title}`}
              />
              <Icon
                idea={expanded ? "collapse" : "expand"}
                size={20}
                color={theme.textMuted}
              />
            </View>
          }
        />
        {expanded ? (
          <View style={styles.groupItems}>
            {entry.children?.map((child) => (
              <View
                key={child.key}
                style={entry.value ? undefined : styles.inert}
                pointerEvents={entry.value ? "auto" : "none"}
              >
                <ItemRow
                  hue={child.hue}
                  title={child.title}
                  count={child.count}
                  // A child of a switched-OFF master draws nothing whatever its
                  // own switch says, so it reads as off — the master is the
                  // stronger statement and the row must not contradict it. It
                  // is also untappable there: flipping hidden state behind a
                  // master that is already hiding everything is a control that
                  // answers a tap with nothing.
                  visible={child.value}
                  onVisibility={() => child.onChange(!child.value)}
                />
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={entry.inert ? styles.inert : undefined}
      pointerEvents={entry.inert ? "none" : "auto"}
    >
      <SwitchRow
        icon={entry.icon}
        hue={entry.hue}
        title={entry.title}
        description={entry.note}
        badge={<Text style={styles.count}>{entry.count}</Text>}
        checked={entry.value}
        onChange={entry.onChange}
      />
    </View>
  );
}

function LayersTab({
  layers,
  onImportFile,
}: {
  layers: LayerToggleEntry[];
  onImportFile: () => void;
}) {
  const theme = useTheme();
  const { assetHue } = useHues();
  const styles = useStyles();

  const entryRow = (key: string) => {
    const entry = layers.find((candidate) => candidate.key === key);
    return entry ? <LayerRow entry={entry} /> : null;
  };

  // Exhaustive by type: a row the contract names and this tab does not draw, or
  // the reverse, fails `tsc` (`MAP_OVERLAYS`, shared/src/contracts).
  const rows: Record<
    SectionKeysOn<typeof MAP_OVERLAYS, "gps">,
    () => ReactNode
  > = {
    places: () => entryRow("places"),
    ways: () => entryRow("ways"),
    geoPdfs: () => entryRow("geoPdfs"),
    importFile: () => (
      <Row
        icon="upload"
        hue={theme.neutral}
        title={copy.importFile}
        onPress={onImportFile}
      />
    ),
  };

  return (
    <View style={styles.body}>
      {contractSectionKeys(MAP_OVERLAYS, "gps").map((key) => (
        <Fragment key={key}>{rows[key]()}</Fragment>
      ))}
    </View>
  );
}

/** One line inside a layer group: a colour dot, its name, its switch. */
function ItemRow({
  hue,
  title,
  count,
  visible,
  onVisibility,
}: {
  hue: string;
  title: string;
  /** How many of this kind exist. Absent on a topo layer, where the row is a
   *  layer TYPE over an area rather than a countable pile of things. */
  count?: number;
  visible: boolean;
  onVisibility: () => void;
}) {
  const styles = useStyles();

  return (
    <SwitchRow
      leading={<View style={[styles.dot, { backgroundColor: hue }]} />}
      title={title}
      style={styles.itemRow}
      badge={count != null ? <Text style={styles.count}>{count}</Text> : null}
      checked={visible}
      onChange={onVisibility}
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
  const theme = useTheme();
  const { assetHue } = useHues();
  const styles = useStyles();

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
        icon="saveOffline"
        hue={assetHue.region}
        title="Save maps for offline use"
        subtitle={online ? "Pick an area and the maps" : "Needs a connection"}
        disabled={!online}
        onPress={onSaveArea}
      />
      <SwitchRow
        icon="offline"
        hue={assetHue.region}
        title="Offline maps only"
        description="Use only saved maps, even with signal"
        descriptionNumberOfLines={2}
        checked={offlineOnly}
        onChange={onOfflineOnlyChange}
      />

      <SectionHeader title="On this phone" />
      <Row
        icon="device"
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
        right={<Icon idea="disclosure" size={20} color={theme.textMuted} />}
      />
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  // The gap the list scrolls against, exactly as a screen's pinned rail owns
  // (DESIGN.md).
  rail: { paddingBottom: spacing(1.5) },
  body: { gap: spacing(1) },
  group: { gap: spacing(0.5) },
  // A row something above it has already decided for.
  inert: { opacity: opacity.disabled },
  // Items hang off their group's row, indented so the hierarchy is visible
  // without a second card colour.
  groupItems: { gap: spacing(0.5), paddingLeft: spacing(2) },
  itemRow: { minHeight: controlSize.lg, paddingVertical: spacing(1) },
  dot: { width: 12, height: 12, borderRadius: 6 },
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  // Tabular so a column of counts lines up down the tab rather than shuffling
  // by a digit's width.
  count: {
    ...textRole.control,
    color: theme.textMuted,
    fontVariant: ["tabular-nums"],
  },
}));
