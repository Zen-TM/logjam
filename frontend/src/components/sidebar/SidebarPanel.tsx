import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useIsMobile } from "../../useIsMobile";
import BottomSheet from "./BottomSheet";
import type { SheetSnap } from "./BottomSheet";
import { PANEL_TITLES, type LogsView, type MapsView, type PanelId } from "./panels";
import type {
  TPlace,
  TFilters,
  TFriend,
  TFriendRequest,
  TNotification,
  TTripLog,
  TUser,
  TRoute,
  PlaceTrack,
  TPlaceType,
} from "../../placeUtils";
import type { RegionBbox, StandaloneFile, VectorStyleSettings, TopoExportJobView, ScopedCustomFieldDef } from "@logjam/shared";
import type { TopoJob, GeoJsonPolygonal } from "../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import type { GeoPdfTemplate } from "../dialogs/GeoPdfDialog";
import { ChipRail } from "../../ui";
import classes from "./SidebarPanel.module.css";
import PlacesPanel, { type MapKind } from "./panels/PlacesPanel";
import GeoPdfsPanel from "./panels/GeoPdfsPanel";
import LidarPanel from "./panels/LidarPanel";
import FriendsPanel from "./panels/FriendsPanel";
import NotificationsPanel from "./panels/NotificationsPanel";
import PlaceDetailPanel from "./panels/PlaceDetailPanel";
import TripDetailPanel from "./panels/TripDetailPanel";
import { placesBounds } from "./panels/placesModel";
import RoutesPanel from "./panels/RoutesPanel";
import type { WayItem } from "./panels/waysModel";
import type { WayVerbId } from "./panels/wayActions";
import AccountPanel from "./panels/AccountPanel";
import SettingsPanel from "./panels/SettingsPanel";
import TripLogsPanel from "./panels/TripLogsPanel";
import AnalyticsPanel from "./panels/AnalyticsPanel";

const LOGS_VIEWS = [
  { value: "logs", label: "Logs" },
  { value: "stats", label: "Stats" },
] as const;

const MAPS_VIEWS = [
  { value: "geopdfs", label: "GeoPDFs" },
  { value: "lidar", label: "LiDAR topos" },
] as const;

function SidebarPanel({
  activePanel,
  onClose,
  onTopoFlyTarget,
  logsView,
  onLogsViewChange,
  mapsView,
  onMapsViewChange,
  onStartDrawingRoute,
  waysLoaded,
  // Places
  places,
  placesLoaded,
  placesTotal,
  sharedPlaces,
  onAddPlace,
  onOpenUnifiedImport,
  onRefetch,
  filters,
  onChangeFilters,
  onDrawFilterArea,
  onFilterToMapView,
  openFiltersRequested,
  onOpenFiltersConsumed,
  onFiltersOpenChange,
  onHoverPlace,
  onMakeMap,
  onSharePlaces,
  onFlyToPlace,
  // GeoPDFs
  onOpenGeoPdf,
  onOpenGeoPdfWithTemplate,
  onEditGeoPdfTemplate,
  onCreateGeoPdfTemplate,
  geoPdfTemplateRefetch,
  topoTemplateRefetch,
  geoPdfJobsRefetch,
  // LiDAR
  activeTopoJobs,
  completedTopoJobs,
  topoJobsLoaded,
  topoExports,
  topoExportsTotal,
  onRefetchTopoExports,
  setLidarJobToggles,
  onOpenTopo,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onQuotaChanged,
  currentUser,
  currentUserError,
  onRetryCurrentUser,
  onOpenTopoWithTemplate,
  // Friends
  friends,
  friendRequests,
  onRefetchFriends,
  onRefetchShared,
  // Notifications
  notifications,
  notificationsLoaded,
  notificationsError,
  notificationsTotal,
  onRefetchNotifications,
  onOverrideNotificationRead,
  setSelectedPlaceID,
  setActivePanel,
  // Place detail
  place,
  isOwnedPlace,
  allRoutes,
  placeTracks,
  standaloneFiles,
  standaloneFilesError,
  onOpenWay,
  wayDetail,
  drawPanel,
  currentUserId,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  // Trip logs
  tripLogs,
  selectedTripLogId,
  setSelectedTripLogId,
  tripLogsTotal,
  tripLogsLoaded,
  onRefetchTripLogs,
  customFieldDefs,
  onCustomFieldDefsChange,
  placeCustomFieldDefs,
  onPlaceCustomFieldDefsChange,
  placeTypes,
  onPlaceTypesChange,
  // Vector styles
  vectorStyle,
  onVectorStyleChange,
  // Mobile: collapse the bottom sheet to peek during map-pick flows
  collapseToPeek,
}: {
  activePanel: PanelId | null;
  onClose: () => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygonal) => void;
  logsView: LogsView;
  onLogsViewChange: (view: LogsView) => void;
  mapsView: MapsView;
  onMapsViewChange: (view: MapsView) => void;
  onStartDrawingRoute: () => void;
  /** False until all three of Ways' fetches settle. */
  waysLoaded: boolean;
  // Places
  places: TPlace[];
  placesLoaded: boolean;
  placesTotal: number | null;
  sharedPlaces: TPlace[];
  onAddPlace: () => void;
  onOpenUnifiedImport: () => void;
  onRefetch: () => void;
  filters: TFilters;
  onChangeFilters: (f: TFilters) => void;
  /** Close the panel and arm the map's box-draw for the area filter. */
  onDrawFilterArea: () => void;
  /** Set the area filter to whatever the map is currently showing. */
  onFilterToMapView: () => void;
  /** Places should open its filter sheet on arrival (back from drawing an area). */
  openFiltersRequested: boolean;
  onOpenFiltersConsumed: () => void;
  onFiltersOpenChange: (open: boolean) => void;
  onHoverPlace: (id: string | null) => void;
  onMakeMap: (bounds: RegionBbox, kind: MapKind) => void;
  onSharePlaces: (ids: string[]) => void;
  onFlyToPlace: (lat: number, lng: number) => void;
  // GeoPDFs
  onOpenGeoPdf: () => void;
  onOpenGeoPdfWithTemplate: (id: string) => void;
  onEditGeoPdfTemplate: (t: GeoPdfTemplate) => void;
  onCreateGeoPdfTemplate: () => void;
  geoPdfTemplateRefetch: number;
  topoTemplateRefetch: number;
  geoPdfJobsRefetch: number;
  // LiDAR
  activeTopoJobs: TopoJob[];
  completedTopoJobs: CompletedTopoJob[];
  /** False until the first fetch of completed topos settles. */
  topoJobsLoaded: boolean;
  topoExports: TopoExportJobView[];
  topoExportsTotal: number | null;
  onRefetchTopoExports: () => void;
  setLidarJobToggles: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  onOpenTopo: () => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onQuotaChanged: () => void;
  currentUser: TUser | null;
  /** Set when the signed-in user's own record failed to load — the one fetch
   *  the Account page has no fallback for. */
  currentUserError: string | null;
  onRetryCurrentUser: () => void;
  onOpenTopoWithTemplate: (templateId: string) => void;
  // Friends
  friends: TFriend[];
  friendRequests: TFriendRequest[];
  onRefetchFriends: () => void;
  onRefetchShared: () => void;
  // Notifications
  notifications: TNotification[];
  /** False until the first fetch settles — an empty inbox before then is not
   *  "Nothing yet". */
  notificationsLoaded: boolean;
  notificationsError: string | null;
  notificationsTotal: number | null;
  onRefetchNotifications: () => void;
  onOverrideNotificationRead: (ids: string[], read: boolean | null) => void;
  setSelectedPlaceID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  // Place detail
  place: TPlace | undefined;
  isOwnedPlace: boolean;
  // Ways
  allRoutes: TRoute[];
  placeTracks: PlaceTrack[];
  standaloneFiles: StandaloneFile[];
  standaloneFilesError: string | null;
  /** Open a way's page, centring the map on it; `verb` arms one of its actions. */
  onOpenWay: (way: WayItem, verb?: WayVerbId) => void;
  /**
   * The open way's page and the route tool, built by App because App owns the
   * draft and the selection. Passed as nodes rather than as the fourteen props
   * each would otherwise thread through this shell — the same shape
   * `layersButton` and `notices` already take.
   */
  wayDetail: ReactNode;
  drawPanel: ReactNode;
  currentUserId: string | null;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  // Trip logs
  tripLogs: TTripLog[];
  selectedTripLogId: string | null;
  setSelectedTripLogId: (id: string | null) => void;
  tripLogsTotal: number | null;
  /** False until the first trip fetch settles. */
  tripLogsLoaded: boolean;
  onRefetchTripLogs: () => void;
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  placeTypes: TPlaceType[];
  onPlaceTypesChange: (types: TPlaceType[]) => void;
  onPlaceCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  // Vector styles
  vectorStyle: VectorStyleSettings | null;
  onVectorStyleChange: (next: VectorStyleSettings) => void;
  // Mobile
  collapseToPeek: boolean;
}) {
  const isMobile = useIsMobile();
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("half");
  // Remember the snap to restore to once a map-pick flow ends.
  const snapBeforePeek = useRef<SheetSnap>("half");
  const snapRef = useRef<SheetSnap>(sheetSnap);
  snapRef.current = sheetSnap;
  const collapseToPeekRef = useRef(collapseToPeek);
  collapseToPeekRef.current = collapseToPeek;

  useEffect(() => {
    if (collapseToPeek) {
      snapBeforePeek.current = snapRef.current;
      setSheetSnap("peek");
    } else {
      setSheetSnap(snapBeforePeek.current);
    }
    // Intentionally only reacts to collapseToPeek; snap is read via ref.
  }, [collapseToPeek]);

  // Switching panels (a tab tap) while the sheet is at peek would otherwise
  // swap the panel content behind an almost-fully-collapsed sheet — the new
  // panel is effectively invisible (MOBILE-9). Raise to "half" on any panel
  // change, unless a map-pick flow is the one driving the sheet to peek (that
  // collapse is intentional — leave it alone).
  const prevActivePanelRef = useRef(activePanel);
  useEffect(() => {
    if (activePanel !== prevActivePanelRef.current) {
      prevActivePanelRef.current = activePanel;
      if (!collapseToPeekRef.current) {
        setSheetSnap((current) => (current === "peek" ? "half" : current));
      }
    }
  }, [activePanel]);

  // Let a panel request the sheet expand to full (e.g. PlacesPanel when its
  // filters open). Stable so the panel's effect only fires on the actual open,
  // not every render. No-op on desktop where there's no sheet.
  const expandSheetToFull = useCallback(() => {
    if (isMobile) setSheetSnap("full");
  }, [isMobile]);

  // The same two calls PlacesPanel and the inbox make. Handed to the waypoint
  // and route surfaces so a row that is only visible BECAUSE of a shared place
  // can send the user to the place that brought it — the one place its share
  // can actually be removed.
  const openPlaceDetail = useCallback(
    (placeId: string) => {
      setSelectedPlaceID(placeId);
      setActivePanel("place-detail");
    },
    [setSelectedPlaceID, setActivePanel],
  );

  // The same pair for a trip: its page is where a trip is READ, and every
  // surface that lists one opens it the same way.
  const openTripDetail = (tripLogId: string) => {
    setSelectedTripLogId(tripLogId);
    setActivePanel("trip-detail");
  };

  if (!activePanel) return null;

  // The panel's accessible name. Every page draws its own hero now, so this
  // titles the landmark and nothing else — place-detail computes it for the
  // same reason, after losing its header.
  const title =
    activePanel === "place-detail" && place ? place.name : PANEL_TITLES[activePanel];

  // A page with two views draws its switch under its own hero, so the hero
  // stays the page's first line (DESIGN.md §2).
  const logsViewRail = (
    <ChipRail label="Logs view" options={LOGS_VIEWS} value={logsView} onChange={onLogsViewChange} />
  );
  const mapsViewRail = (
    <ChipRail label="Maps view" options={MAPS_VIEWS} value={mapsView} onChange={onMapsViewChange} />
  );

  const panelContent = (
    <>
      <div className={classes.panelBody}>
        {activePanel === "places" && (
          <PlacesPanel
            places={places}
            placesLoaded={placesLoaded}
            placesTotal={placesTotal}
            sharedPlaces={sharedPlaces}
            placeTypes={placeTypes}
            placeCustomFieldDefs={placeCustomFieldDefs}
            filters={filters}
            onChangeFilters={onChangeFilters}
            onAddPlace={onAddPlace}
            onOpenUnifiedImport={onOpenUnifiedImport}
            onRefetch={onRefetch}
            onQuotaChanged={onQuotaChanged}
            onDrawFilterArea={onDrawFilterArea}
            onFilterToMapView={onFilterToMapView}
            openFiltersRequested={openFiltersRequested}
            onOpenFiltersConsumed={onOpenFiltersConsumed}
            onFiltersOpenChange={onFiltersOpenChange}
            onFlyToPlace={onFlyToPlace}
            setSelectedPlaceID={setSelectedPlaceID}
            setActivePanel={setActivePanel}
            onHoverPlace={onHoverPlace}
            onMakeMap={onMakeMap}
            onSharePlaces={onSharePlaces}
            onExpandSheet={expandSheetToFull}
          />
        )}
        {activePanel === "maps" && mapsView === "geopdfs" && (
          <GeoPdfsPanel
            views={mapsViewRail}
            friends={friends}
            onOpenGeoPdf={onOpenGeoPdf}
            onOpenGeoPdfWithTemplate={onOpenGeoPdfWithTemplate}
            onEditGeoPdfTemplate={onEditGeoPdfTemplate}
            onCreateGeoPdfTemplate={onCreateGeoPdfTemplate}
            refetchTrigger={geoPdfTemplateRefetch}
            geoPdfJobsRefetch={geoPdfJobsRefetch}
          />
        )}
        {activePanel === "maps" && mapsView === "lidar" && (
          <LidarPanel
            views={mapsViewRail}
            topoJobsLoaded={topoJobsLoaded}
            onSheetOpenChange={onFiltersOpenChange}
            onExpandSheet={expandSheetToFull}
            friends={friends}
            activeTopoJobs={activeTopoJobs}
            completedTopoJobs={completedTopoJobs}
            topoExports={topoExports}
            topoExportsTotal={topoExportsTotal}
            onRefetchTopoExports={onRefetchTopoExports}
            setLidarJobToggles={setLidarJobToggles}
            onOpenTopo={onOpenTopo}
            onTopoFlyTarget={onTopoFlyTarget}
            onRefetchCompletedTopoJobs={onRefetchCompletedTopoJobs}
            onDismissActiveJob={onDismissActiveJob}
            onOpenTopoWithTemplate={onOpenTopoWithTemplate}
            onQuotaChanged={onQuotaChanged}
            vectorStyle={vectorStyle}
            onVectorStyleChange={onVectorStyleChange}
            templateRefetchTrigger={topoTemplateRefetch}
          />
        )}
        {activePanel === "friends" && (
          <FriendsPanel
            friends={friends}
            friendRequests={friendRequests}
            onRefetchFriends={onRefetchFriends}
            onRefetchShared={onRefetchShared}
            onRefetchNotifications={onRefetchNotifications}
          />
        )}
        {activePanel === "inbox" && (
          <NotificationsPanel
            notifications={notifications}
            notificationsLoaded={notificationsLoaded}
            notificationsError={notificationsError}
            notificationsTotal={notificationsTotal}
            onRefetchNotifications={onRefetchNotifications}
            onOverrideRead={onOverrideNotificationRead}
            onRefetchFriends={onRefetchFriends}
            setSelectedPlaceID={setSelectedPlaceID}
            setActivePanel={setActivePanel}
            onMapsViewChange={onMapsViewChange}
            onTopoFlyTarget={onTopoFlyTarget}
          />
        )}
        {activePanel === "logs" && logsView === "stats" && (
          <AnalyticsPanel
            views={logsViewRail}
            tripLogs={tripLogs}
            tripLogsTotal={tripLogsTotal}
            loaded={tripLogsLoaded}
            places={places}
            customFieldDefs={customFieldDefs}
            placeCustomFieldDefs={placeCustomFieldDefs}
            placeTypes={placeTypes}
          />
        )}
        {activePanel === "logs" && logsView === "logs" && (
          <TripLogsPanel
            views={logsViewRail}
            tripLogs={tripLogs}
            tripLogsTotal={tripLogsTotal}
            loaded={tripLogsLoaded}
            onRefetchTripLogs={onRefetchTripLogs}
            onOpenTrip={openTripDetail}
            onFiltersOpenChange={onFiltersOpenChange}
            onExpandSheet={expandSheetToFull}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            places={places}
            onPickCoords={onPickCoords}
            pickingCoords={pickingCoords}
            onQuotaChanged={onQuotaChanged}
            onRefetchPlaces={onRefetch}
            onOpenUnifiedImport={onOpenUnifiedImport}
          />
        )}
        {activePanel === "account" && (
          <AccountPanel
            currentUser={currentUser}
            error={currentUserError}
            onRetry={onRetryCurrentUser}
          />
        )}
        {activePanel === "settings" && (
          <SettingsPanel
            currentUser={currentUser}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            placeCustomFieldDefs={placeCustomFieldDefs}
            onPlaceCustomFieldDefsChange={onPlaceCustomFieldDefsChange}
            placeTypes={placeTypes}
            onPlaceTypesChange={onPlaceTypesChange}
          />
        )}
        {activePanel === "place-detail" && (
          <PlaceDetailPanel
            place={place}
            places={places}
            isOwnedPlace={isOwnedPlace}
            friends={friends}
            onRefetch={onRefetch}
            onRefetchShared={onRefetchShared}
            setSelectedPlaceID={setSelectedPlaceID}
            onPickCoords={onPickCoords}
            pickingCoords={pickingCoords}
            onCancelPickCoords={onCancelPickCoords}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            placeCustomFieldDefs={placeCustomFieldDefs}
            onPlaceCustomFieldDefsChange={onPlaceCustomFieldDefsChange}
            placeTypes={placeTypes}
            onQuotaChanged={onQuotaChanged}
            onRefetchTripLogs={onRefetchTripLogs}
            onBack={() => setActivePanel("places")}
            onClose={onClose}
            onFlyToPlace={onFlyToPlace}
            onOpenTrip={openTripDetail}
            onMakeMap={(target, kind) => {
              const bounds = placesBounds([target]);
              if (bounds) onMakeMap(bounds, kind);
            }}
            onSharePlace={(id) => onSharePlaces([id])}
            onAfterDelete={() => setActivePanel("places")}
          />
        )}
        {activePanel === "trip-detail" && (
          <TripDetailPanel
            tripLog={tripLogs.find((trip) => trip.id === selectedTripLogId)}
            places={places}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            existingTripTypes={tripLogs.flatMap((trip) => trip.types)}
            onBack={() => setActivePanel("logs")}
            onClose={onClose}
            onOpenPlace={openPlaceDetail}
            onRefetchTripLogs={onRefetchTripLogs}
            onRefetchPlaces={onRefetch}
            onQuotaChanged={onQuotaChanged}
            onPickCoords={onPickCoords}
            pickingCoords={pickingCoords}
            onAfterDelete={() => setActivePanel("logs")}
          />
        )}
        {activePanel === "way-detail" && wayDetail}
        {activePanel === "way-draw" && drawPanel}
        {activePanel === "ways" && (
          <RoutesPanel
            routes={allRoutes}
            waysLoaded={waysLoaded}
            currentUserId={currentUserId}
            friends={friends}
            placeTracks={placeTracks}
            standaloneFiles={standaloneFiles}
            standaloneFilesError={standaloneFilesError}
            places={[...places, ...sharedPlaces]}
            sharedPlaces={sharedPlaces}
            onStartDrawingRoute={onStartDrawingRoute}
            onOpenUnifiedImport={onOpenUnifiedImport}
            onOpenWay={onOpenWay}
            onOpenPlace={openPlaceDetail}
          />
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet snap={sheetSnap} onSnapChange={setSheetSnap} title={title}>
        {panelContent}
      </BottomSheet>
    );
  }

  return (
    <aside className={classes.panel} aria-label={title}>
      {panelContent}
    </aside>
  );
}

export default SidebarPanel;
