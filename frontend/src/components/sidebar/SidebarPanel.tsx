import { X } from "lucide-react";
import type { PanelId } from "./panels";
import type {
  TCanyon,
  TFilters,
  TFriend,
  TFriendRequest,
  TNotification,
  TTripLog,
  TAnalytics,
} from "../../canyonUtils";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import type { GeoJsonPolygon } from "../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import classes from "./SidebarPanel.module.css";
import OverlaysPanel from "./panels/OverlaysPanel";
import LayersPanel from "./panels/LayersPanel";
import ForgePanel from "./panels/ForgePanel";
import FiltersPanel from "./panels/FiltersPanel";
import FriendsPanel from "./panels/FriendsPanel";
import NotificationsPanel from "./panels/NotificationsPanel";
import CanyonDetailPanel from "./panels/CanyonDetailPanel";
import AccountPanel from "./panels/AccountPanel";
import TripLogsPanel from "./panels/TripLogsPanel";
import AnalyticsPanel from "./panels/AnalyticsPanel";

const PANEL_TITLES: Record<PanelId, string> = {
  overlays: "Overlays",
  layers: "Layers",
  forge: "Forge",
  filters: "Filters",
  "trip-logs": "Trip Logs",
  analytics: "Analytics",
  friends: "Friends",
  notifications: "Notifications",
  account: "Account",
  "canyon-detail": "Canyon Detail",
};

function SidebarPanel({
  activePanel,
  onClose,
  onTopoFlyTarget,
  // Overlays
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles,
  setLidarLayerToggles,
  lidarLayerOrder,
  setLidarLayerOrder,
  completedTopoJobs,
  lidarJobToggles,
  setLidarJobToggles,
  // Layers
  baseLayers,
  activeLayerId,
  onActiveLayerChange,
  mapView,
  // Forge
  onAddCanyon,
  onOpenCanyonCsvImport,
  onOpenTopo,
  onOpenTopoTemplates,
  onOpenGeoPdf,
  onOpenGeoPdfTemplates,
  onStartAreaSelection,
  selectingArea,
  onCancelAreaSelection,
  onRefetch,
  // Filters
  filters,
  onChangeFilters,
  // Friends
  friends,
  friendRequests,
  onRefetchFriends,
  onRefetchShared,
  // Notifications
  notifications,
  onRefetchNotifications,
  setSelectedCanyonID,
  setActivePanel,
  // Canyon detail
  canyon,
  isOwnedCanyon,
  onPickCoords,
  pickingCoords,
  onCancelPickCoords,
  // Trip logs
  tripLogs,
  tripLogsLoading,
  onRefetchTripLogs,
  customFieldDefs,
  onCustomFieldDefsChange,
  canyons,
  // Analytics
  analytics,
  analyticsLoading,
}: {
  activePanel: PanelId | null;
  onClose: () => void;
  onTopoFlyTarget: (footprint: GeoJsonPolygon) => void;
  // Overlays
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (show: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (show: boolean) => void;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  lidarLayerOrder: string[];
  setLidarLayerOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  completedTopoJobs: CompletedTopoJob[];
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  // Layers
  baseLayers: readonly { id: string; name: string; tiles: string[]; maxzoom: number }[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
  // Forge
  onAddCanyon: () => void;
  onOpenCanyonCsvImport: () => void;
  onOpenTopo: () => void;
  onOpenTopoTemplates: () => void;
  onOpenGeoPdf: () => void;
  onOpenGeoPdfTemplates: () => void;
  onStartAreaSelection: () => void;
  selectingArea: boolean;
  onCancelAreaSelection: () => void;
  onRefetch: () => void;
  // Filters
  filters: TFilters;
  onChangeFilters: (filters: TFilters) => void;
  // Friends
  friends: TFriend[];
  friendRequests: TFriendRequest[];
  onRefetchFriends: () => void;
  onRefetchShared: () => void;
  // Notifications
  notifications: TNotification[];
  onRefetchNotifications: () => void;
  setSelectedCanyonID: (id: string | null) => void;
  setActivePanel: (panel: PanelId | null) => void;
  // Canyon detail
  canyon: TCanyon | undefined;
  isOwnedCanyon: boolean;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  pickingCoords: boolean;
  onCancelPickCoords: () => void;
  // Trip logs
  tripLogs: TTripLog[];
  tripLogsLoading: boolean;
  onRefetchTripLogs: () => void;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  canyons: TCanyon[];
  // Analytics
  analytics: TAnalytics | null;
  analyticsLoading: boolean;
}) {
  if (!activePanel) return null;

  const title =
    activePanel === "canyon-detail" && canyon
      ? canyon.name
      : PANEL_TITLES[activePanel];

  return (
    <div className={classes.panel}>
      <div className={classes.panelHeader}>
        <h2 className={classes.panelTitle}>{title}</h2>
        <button className={classes.closeButton} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className={classes.panelBody}>
        {activePanel === "overlays" && (
          <OverlaysPanel
            showOwnedCanyons={showOwnedCanyons}
            setShowOwnedCanyons={setShowOwnedCanyons}
            showSharedCanyons={showSharedCanyons}
            setShowSharedCanyons={setShowSharedCanyons}
            lidarEnabled={lidarEnabled}
            setLidarEnabled={setLidarEnabled}
            lidarLayerToggles={lidarLayerToggles}
            setLidarLayerToggles={setLidarLayerToggles}
            lidarLayerOrder={lidarLayerOrder}
            setLidarLayerOrder={setLidarLayerOrder}
            completedTopoJobs={completedTopoJobs}
            lidarJobToggles={lidarJobToggles}
            setLidarJobToggles={setLidarJobToggles}
          />
        )}
        {activePanel === "layers" && (
          <LayersPanel
            layers={baseLayers}
            activeLayerId={activeLayerId}
            onActiveLayerChange={onActiveLayerChange}
            mapView={mapView}
          />
        )}
        {activePanel === "forge" && (
          <ForgePanel
            onAddCanyon={onAddCanyon}
            onOpenCanyonCsvImport={onOpenCanyonCsvImport}
            onOpenTopo={onOpenTopo}
            onOpenTopoTemplates={onOpenTopoTemplates}
            onOpenGeoPdf={onOpenGeoPdf}
            onOpenGeoPdfTemplates={onOpenGeoPdfTemplates}
            onStartAreaSelection={onStartAreaSelection}
            selectingArea={selectingArea}
            onCancelAreaSelection={onCancelAreaSelection}
            onRefetch={onRefetch}
          />
        )}
        {activePanel === "filters" && (
          <FiltersPanel filters={filters} onChangeFilters={onChangeFilters} />
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
        {activePanel === "notifications" && (
          <NotificationsPanel
            notifications={notifications}
            onRefetchNotifications={onRefetchNotifications}
            onRefetchFriends={onRefetchFriends}
            setSelectedCanyonID={setSelectedCanyonID}
            setActivePanel={setActivePanel}
            onTopoFlyTarget={onTopoFlyTarget}
          />
        )}
        {activePanel === "analytics" && (
          <AnalyticsPanel
            analytics={analytics}
            loading={analyticsLoading}
            tripLogs={tripLogs}
            customFieldDefs={customFieldDefs}
            onRefetchTripLogs={onRefetchTripLogs}
          />
        )}
        {activePanel === "trip-logs" && (
          <TripLogsPanel
            tripLogs={tripLogs}
            loading={tripLogsLoading}
            onRefetchTripLogs={onRefetchTripLogs}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            canyons={canyons}
            onPickCoords={onPickCoords}
            pickingCoords={pickingCoords}
          />
        )}
        {activePanel === "account" && <AccountPanel />}
        {activePanel === "canyon-detail" && (
          <CanyonDetailPanel
            canyon={canyon}
            isOwnedCanyon={isOwnedCanyon}
            friends={friends}
            onRefetch={onRefetch}
            onRefetchShared={onRefetchShared}
            setSelectedCanyonID={setSelectedCanyonID}
            onPickCoords={onPickCoords}
            pickingCoords={pickingCoords}
            onCancelPickCoords={onCancelPickCoords}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
          />
        )}
      </div>
    </div>
  );
}

export default SidebarPanel;
