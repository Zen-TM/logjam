import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useIsMobile } from "../../useIsMobile";
import BottomSheet from "./BottomSheet";
import type { SheetSnap } from "./BottomSheet";
import type { PanelId } from "./panels";
import type {
  TCanyon,
  TFilters,
  TFriend,
  TFriendRequest,
  TNotification,
  TTripLog,
  TAnalytics,
  TUser,
} from "../../canyonUtils";
import type { TripLogCustomFieldDef, VectorStyleSettings, TopoExportJobView } from "@logjam/shared";
import type { TopoJob, GeoJsonPolygonal } from "../dialogs/TopoDialog";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import type { GeoPdfTemplate } from "../dialogs/GeoPdfDialog";
import classes from "./SidebarPanel.module.css";
import LayersPanel from "./panels/LayersPanel";
import CanyonsPanel from "./panels/CanyonsPanel";
import GeoPdfsPanel from "./panels/GeoPdfsPanel";
import LidarPanel from "./panels/LidarPanel";
import FriendsPanel from "./panels/FriendsPanel";
import NotificationsPanel from "./panels/NotificationsPanel";
import CanyonDetailPanel from "./panels/CanyonDetailPanel";
import AccountPanel from "./panels/AccountPanel";
import TripLogsPanel from "./panels/TripLogsPanel";
import AnalyticsPanel from "./panels/AnalyticsPanel";

const PANEL_TITLES: Record<PanelId, string> = {
  layers: "Layers",
  canyons: "Canyons",
  geopdfs: "GeoPDFs",
  lidar: "LiDAR Topos",
  "trip-logs": "Trip Logs",
  analytics: "Analytics",
  friends: "Friends",
  // Matches the NavRail label "Alerts" (MOBILE-11) — the nav item can't take
  // the longer "Notifications" without overflowing its fixed-width slot in
  // the already-crowded bottom nav strip (see MOBILE-7), so this header
  // aligns to the nav instead. NotificationsPanel.tsx's own internal copy is
  // a separate surface, out of scope here.
  notifications: "Alerts",
  account: "Account",
  "canyon-detail": "Canyon Detail",
};

function SidebarPanel({
  activePanel,
  onClose,
  onTopoFlyTarget,
  // Layers (merged overlays+basemap)
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  showCanyonTracks,
  setShowCanyonTracks,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles,
  setLidarLayerToggles,
  lidarLayerOrder,
  setLidarLayerOrder,
  unavailableTopoLayerNames,
  baseLayers,
  activeLayerId,
  onActiveLayerChange,
  mapView,
  // Canyons
  canyons,
  canyonsTotal,
  sharedCanyons,
  onAddCanyon,
  onOpenUnifiedImport,
  onExportCanyons,
  onStartAreaSelection,
  selectingArea,
  onCancelAreaSelection,
  onRefetch,
  filters,
  onChangeFilters,
  filtersAccordionSignal,
  onFlyToCanyon,
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
  tripLogsTotal,
  tripLogsLoading,
  onRefetchTripLogs,
  onRefetchAnalytics,
  customFieldDefs,
  onCustomFieldDefsChange,
  canyonCustomFieldDefs,
  onCanyonCustomFieldDefsChange,
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
  // Layers
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (v: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (v: boolean) => void;
  showCanyonTracks: boolean;
  setShowCanyonTracks: (v: boolean) => void;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: (v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => void;
  lidarLayerOrder: string[];
  setLidarLayerOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  // Layer names whose PMTiles source failed to load (LAYERS-1 badge).
  unavailableTopoLayerNames: Set<string>;
  baseLayers: readonly { id: string; name: string; tiles: string[]; maxzoom: number }[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
  // Canyons
  canyons: TCanyon[];
  canyonsTotal: number | null;
  sharedCanyons: TCanyon[];
  onAddCanyon: () => void;
  onOpenUnifiedImport: () => void;
  onExportCanyons: (canyonIds: string[]) => void;
  onStartAreaSelection: () => void;
  selectingArea: boolean;
  onCancelAreaSelection: () => void;
  onRefetch: () => void;
  filters: TFilters;
  onChangeFilters: (f: TFilters) => void;
  filtersAccordionSignal: number;
  onFlyToCanyon: (lat: number, lng: number) => void;
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
  tripLogsTotal: number | null;
  tripLogsLoading: boolean;
  onRefetchTripLogs: () => void;
  onRefetchAnalytics: () => void;
  customFieldDefs: TripLogCustomFieldDef[];
  onCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
  canyonCustomFieldDefs: TripLogCustomFieldDef[];
  onCanyonCustomFieldDefsChange: (defs: TripLogCustomFieldDef[]) => void;
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

  // Switching panels (NavRail tap) while the sheet is at peek would otherwise
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

  // Let a panel request the sheet expand to full (e.g. CanyonsPanel when its
  // filters accordion opens). Stable so the panel's effect only fires on the
  // actual open, not every render. No-op on desktop where there's no sheet.
  const expandSheetToFull = useCallback(() => {
    if (isMobile) setSheetSnap("full");
  }, [isMobile]);

  if (!activePanel) return null;

  const title =
    activePanel === "canyon-detail" && canyon
      ? canyon.name
      : PANEL_TITLES[activePanel];

  const panelContent = (
    <>
      <div className={classes.panelHeader}>
        <h2 className={classes.panelTitle}>{title}</h2>
        <button className={classes.closeButton} onClick={onClose} aria-label="Close panel">
          <X size={18} />
        </button>
      </div>
      <div className={classes.panelBody} data-active-panel={activePanel}>
        {activePanel === "layers" && (
          <LayersPanel
            showOwnedCanyons={showOwnedCanyons}
            setShowOwnedCanyons={setShowOwnedCanyons}
            showSharedCanyons={showSharedCanyons}
            setShowSharedCanyons={setShowSharedCanyons}
            showCanyonTracks={showCanyonTracks}
            setShowCanyonTracks={setShowCanyonTracks}
            lidarEnabled={lidarEnabled}
            setLidarEnabled={setLidarEnabled}
            lidarLayerToggles={lidarLayerToggles}
            setLidarLayerToggles={setLidarLayerToggles}
            lidarLayerOrder={lidarLayerOrder}
            setLidarLayerOrder={setLidarLayerOrder}
            unavailableTopoLayerNames={unavailableTopoLayerNames}
            layers={baseLayers}
            activeLayerId={activeLayerId}
            onActiveLayerChange={onActiveLayerChange}
            mapView={mapView}
          />
        )}
        {activePanel === "canyons" && (
          <CanyonsPanel
            canyons={canyons}
            canyonsTotal={canyonsTotal}
            sharedCanyons={sharedCanyons}
            onAddCanyon={onAddCanyon}
            onOpenUnifiedImport={onOpenUnifiedImport}
            onExportCanyons={onExportCanyons}
            onStartAreaSelection={onStartAreaSelection}
            onCancelAreaSelection={onCancelAreaSelection}
            selectingArea={selectingArea}
            onRefetch={onRefetch}
            filters={filters}
            onChangeFilters={onChangeFilters}
            filtersAccordionSignal={filtersAccordionSignal}
            onFlyToCanyon={onFlyToCanyon}
            setSelectedCanyonID={setSelectedCanyonID}
            setActivePanel={setActivePanel}
            canyonCustomFieldDefs={canyonCustomFieldDefs}
            onExpandSheet={expandSheetToFull}
          />
        )}
        {activePanel === "geopdfs" && (
          <GeoPdfsPanel
            onOpenGeoPdf={onOpenGeoPdf}
            onOpenGeoPdfWithTemplate={onOpenGeoPdfWithTemplate}
            onEditGeoPdfTemplate={onEditGeoPdfTemplate}
            onCreateGeoPdfTemplate={onCreateGeoPdfTemplate}
            refetchTrigger={geoPdfTemplateRefetch}
            geoPdfJobsRefetch={geoPdfJobsRefetch}
          />
        )}
        {activePanel === "lidar" && (
          <LidarPanel
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
        {activePanel === "notifications" && (
          <NotificationsPanel
            notifications={notifications}
            notificationsTotal={notificationsTotal}
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
            onRefetchAnalytics={onRefetchAnalytics}
            onQuotaChanged={onQuotaChanged}
          />
        )}
        {activePanel === "trip-logs" && (
          <TripLogsPanel
            tripLogs={tripLogs}
            tripLogsTotal={tripLogsTotal}
            loading={tripLogsLoading}
            onRefetchTripLogs={onRefetchTripLogs}
            onRefetchAnalytics={onRefetchAnalytics}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            canyons={canyons}
            onPickCoords={onPickCoords}
            pickingCoords={pickingCoords}
            onQuotaChanged={onQuotaChanged}
            onRefetchCanyons={onRefetch}
            onOpenUnifiedImport={onOpenUnifiedImport}
          />
        )}
        {activePanel === "account" && (
          <AccountPanel
            currentUser={currentUser}
            customFieldDefs={customFieldDefs}
            onCustomFieldDefsChange={onCustomFieldDefsChange}
            canyonCustomFieldDefs={canyonCustomFieldDefs}
            onCanyonCustomFieldDefsChange={onCanyonCustomFieldDefsChange}
          />
        )}
        {activePanel === "canyon-detail" && (
          <CanyonDetailPanel
            canyon={canyon}
            canyons={canyons}
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
            canyonCustomFieldDefs={canyonCustomFieldDefs}
            onCanyonCustomFieldDefsChange={onCanyonCustomFieldDefsChange}
            onQuotaChanged={onQuotaChanged}
            onRefetchTripLogs={onRefetchTripLogs}
            onAfterDelete={() => setActivePanel("canyons")}
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

  return <div className={classes.panel}>{panelContent}</div>;
}

export default SidebarPanel;
