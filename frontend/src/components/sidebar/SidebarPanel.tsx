import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
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
  TAnalytics,
  TUser,
  TRoute,
  PlaceTrack,
  TPlaceType,
} from "../../placeUtils";
import type { RegionBbox, StandaloneFile, VectorStyleSettings, TopoExportJobView, ScopedCustomFieldDef } from "@logjam/shared";
import type { TopoJob, GeoJsonPolygonal } from "../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import type { GeoPdfTemplate } from "../dialogs/GeoPdfDialog";
import { ChipRail, IconButton } from "../../ui";
import classes from "./SidebarPanel.module.css";
import PlacesPanel, { type MapKind } from "./panels/PlacesPanel";
import GeoPdfsPanel from "./panels/GeoPdfsPanel";
import LidarPanel from "./panels/LidarPanel";
import FriendsPanel from "./panels/FriendsPanel";
import NotificationsPanel from "./panels/NotificationsPanel";
import PlaceDetailPanel from "./panels/PlaceDetailPanel";
import RouteDetailPanel from "./panels/RouteDetailPanel";
import RoutesPanel from "./panels/RoutesPanel";
import AccountPanel from "./panels/AccountPanel";
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
  revealPlaceId,
  onRevealConsumed,
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
  topoExports,
  topoExportsTotal,
  onRefetchTopoExports,
  lidarJobToggles,
  setLidarJobToggles,
  onOpenTopo,
  onRefetchCompletedTopoJobs,
  onDismissActiveJob,
  onQuotaChanged,
  currentUser,
  onOpenTopoWithTemplate,
  // Friends
  friends,
  friendRequests,
  onRefetchFriends,
  onRefetchShared,
  // Notifications
  notifications,
  notificationsTotal,
  onRefetchNotifications,
  setSelectedPlaceID,
  setActivePanel,
  // Place detail
  place,
  isOwnedPlace,
  selectedRoute,
  allRoutes,
  placeTracks,
  standaloneFiles,
  standaloneFilesError,
  shownStandaloneIds,
  onToggleStandaloneFile,
  onRenameStandaloneFile,
  onDeleteStandaloneFile,
  onFlyToStandaloneFile,
  onSelectRoute,
  onRouteHoverPosition,
  currentUserId,
  onEditRoute,
  onRoutesChanged,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  // Trip logs
  tripLogs,
  tripLogsTotal,
  tripLogsLoading,
  onRefetchTripLogs,
  onRefetchAnalytics,
  customFieldDefs,
  onCustomFieldDefsChange,
  placeCustomFieldDefs,
  onPlaceCustomFieldDefsChange,
  placeTypes,
  onPlaceTypesChange,
  // Analytics
  analytics,
  analyticsLoading,
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
  revealPlaceId: string | null;
  onRevealConsumed: () => void;
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
  topoExports: TopoExportJobView[];
  topoExportsTotal: number | null;
  onRefetchTopoExports: () => void;
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  onOpenTopo: () => void;
  onRefetchCompletedTopoJobs: () => void;
  onDismissActiveJob: (jobId: string) => void;
  onQuotaChanged: () => void;
  currentUser: TUser | null;
  onOpenTopoWithTemplate: (templateId: string) => void;
  // Friends
  friends: TFriend[];
  friendRequests: TFriendRequest[];
  onRefetchFriends: () => void;
  onRefetchShared: () => void;
  // Notifications
  notifications: TNotification[];
  notificationsTotal: number | null;
  onRefetchNotifications: () => void;
  setSelectedPlaceID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  // Place detail
  place: TPlace | undefined;
  isOwnedPlace: boolean;
  // Ways
  selectedRoute: TRoute | null;
  allRoutes: TRoute[];
  placeTracks: PlaceTrack[];
  standaloneFiles: StandaloneFile[];
  standaloneFilesError: string | null;
  shownStandaloneIds: string[];
  onToggleStandaloneFile: (id: string) => void;
  onRenameStandaloneFile: (id: string, displayName: string) => void;
  onDeleteStandaloneFile: (file: StandaloneFile) => Promise<void>;
  onFlyToStandaloneFile: (file: StandaloneFile) => void;
  onSelectRoute: (id: string) => void;
  onRouteHoverPosition: (position: [number, number] | null) => void;
  currentUserId: string | null;
  onEditRoute: (route: TRoute) => void;
  onRoutesChanged: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  // Trip logs
  tripLogs: TTripLog[];
  tripLogsTotal: number | null;
  tripLogsLoading: boolean;
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  placeTypes: TPlaceType[];
  onPlaceTypesChange: (types: TPlaceType[]) => void;
  onPlaceCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  // Analytics
  analytics: TAnalytics | null;
  analyticsLoading: boolean;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  if (!activePanel) return null;

  const title =
    activePanel === "place-detail" && place ? place.name : PANEL_TITLES[activePanel];

  // Places opens with its own hero, which names the page; every other page
  // keeps a plain header until it is redesigned.
  const header =
    activePanel === "places" ? null : (
      <header className={classes.panelHeader}>
        <h2 className={classes.panelTitle}>{title}</h2>
        <IconButton icon={X} label="Close panel" onClick={onClose} />
      </header>
    );

  const views =
    activePanel === "logs" ? (
      <div className={classes.views}>
        <ChipRail label="Logs view" options={LOGS_VIEWS} value={logsView} onChange={onLogsViewChange} />
      </div>
    ) : activePanel === "maps" ? (
      <div className={classes.views}>
        <ChipRail label="Maps view" options={MAPS_VIEWS} value={mapsView} onChange={onMapsViewChange} />
      </div>
    ) : null;

  const panelContent = (
    <>
      {header}
      {views}
      <div className={classes.panelBody} data-active-panel={activePanel}>
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
            revealPlaceId={revealPlaceId}
            onRevealConsumed={onRevealConsumed}
            onMakeMap={onMakeMap}
            onSharePlaces={onSharePlaces}
            onExpandSheet={expandSheetToFull}
          />
        )}
        {activePanel === "maps" && mapsView === "geopdfs" && (
          <GeoPdfsPanel
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
            friends={friends}
            activeTopoJobs={activeTopoJobs}
            completedTopoJobs={completedTopoJobs}
            topoExports={topoExports}
            topoExportsTotal={topoExportsTotal}
            onRefetchTopoExports={onRefetchTopoExports}
            lidarJobToggles={lidarJobToggles}
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
            notificationsTotal={notificationsTotal}
            onRefetchNotifications={onRefetchNotifications}
            onRefetchFriends={onRefetchFriends}
            setSelectedPlaceID={setSelectedPlaceID}
            setActivePanel={setActivePanel}
            onTopoFlyTarget={onTopoFlyTarget}
          />
        )}
        {activePanel === "logs" && logsView === "stats" && (
          <AnalyticsPanel
            analytics={analytics}
            loading={analyticsLoading}
            tripLogs={tripLogs}
            customFieldDefs={customFieldDefs}
            onRefetchTripLogs={onRefetchTripLogs}
            onRefetchAnalytics={onRefetchAnalytics}
            onQuotaChanged={onQuotaChanged}
          />
        )}
        {activePanel === "logs" && logsView === "logs" && (
          <TripLogsPanel
            tripLogs={tripLogs}
            tripLogsTotal={tripLogsTotal}
            loading={tripLogsLoading}
            onRefetchTripLogs={onRefetchTripLogs}
            onRefetchAnalytics={onRefetchAnalytics}
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
        {(activePanel === "account" || activePanel === "settings") && (
          <AccountPanel
            view={activePanel}
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
            onAfterDelete={() => setActivePanel("places")}
          />
        )}
        {activePanel === "route-detail" && (
          <RouteDetailPanel
            route={selectedRoute}
            currentUserId={currentUserId}
            ownedPlaces={places}
            sharedPlaces={sharedPlaces}
            friends={friends}
            allRoutes={allRoutes}
            onEdit={onEditRoute}
            onChanged={onRoutesChanged}
            onClose={() => setActivePanel(null)}
            onOpenPlace={openPlaceDetail}
            onHoverPosition={onRouteHoverPosition}
          />
        )}
        {activePanel === "ways" && (
          <RoutesPanel
            routes={allRoutes}
            currentUserId={currentUserId}
            placeTracks={placeTracks}
            standaloneFiles={standaloneFiles}
            standaloneFilesError={standaloneFilesError}
            shownStandaloneIds={shownStandaloneIds}
            onToggleStandaloneFile={onToggleStandaloneFile}
            onRenameStandaloneFile={onRenameStandaloneFile}
            onDeleteStandaloneFile={onDeleteStandaloneFile}
            onFlyToStandaloneFile={onFlyToStandaloneFile}
            places={[...places, ...sharedPlaces]}
            onStartDrawingRoute={onStartDrawingRoute}
            onSelectRoute={onSelectRoute}
            setSelectedPlaceID={setSelectedPlaceID}
            setActivePanel={setActivePanel}
          />
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet snap={sheetSnap} onSnapChange={setSheetSnap}>
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
