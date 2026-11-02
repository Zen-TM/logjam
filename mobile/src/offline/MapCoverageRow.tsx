// Whether an offline map covers a place or a way, with the one verb that saves
// one framed on it (mobile/DESIGN.md §8). Drawn on the page of the thing, so
// the answer to "will I have a map there?" is read before leaving signal.
import { useNavigation } from "@react-navigation/native";

import { BASEMAP_CATALOG } from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { readBasemapPreference } from "../map/basemapPreference";
import { Button, Row } from "../ui";
import {
  coveredByOfflineMaps,
  routeCoveredByOfflineMaps,
} from "./coveredByOfflineMaps";
import { useMapArtifacts } from "./useMapArtifacts";

export function MapCoverageRow({
  bbox,
  route,
  onSave,
}: {
  /** The ground to cover, `[west, south, east, north]`: what Save map frames. */
  bbox: [number, number, number, number];
  /** A way's points: covered only when every point along it is. */
  route?: [number, number][];
  /** Leaves the page that holds the row (a sheet closes itself). */
  onSave?: () => void;
}) {
  const navigation = useNavigation();
  const online = useConnectivity() === "online";
  const { artifacts, loaded } = useMapArtifacts();
  // Nothing until the registry is read: "no map" is not yet known to be true.
  if (!loaded) return null;

  // Only what holds the basemap the map is drawn with counts: an imagery clip
  // is no help to a map open on Topo.
  const basemapId = readBasemapPreference();
  const basemapName = BASEMAP_CATALOG.find((e) => e.id === basemapId)?.name;
  const held = artifacts.filter((a) => a.logicalKey === basemapId);
  const covered = route
    ? routeCoveredByOfflineMaps(route, held)
    : coveredByOfflineMaps(bbox, held);
  if (covered)
    return (
      <Row
        icon="saveOffline"
        title="Offline map saved for this area"
        subtitle={basemapName}
      />
    );
  return (
    <Row
      icon="saveOffline"
      title="No offline map for this area"
      subtitle={
        online ? basemapName : unavailableReasonText("needs-connection")
      }
      right={
        <Button
          compact
          variant="outlineAccent"
          label="Save map"
          disabled={!online}
          onPress={() => {
            onSave?.();
            // Every stack sits under the tabs, whose Map tab holds the framing
            // screen (the plan page's "Download the map for this area" goes
            // the same way).
            navigation.getParent()?.navigate("Map", {
              screen: "MapRegionDownload",
              params: { bounds: bbox },
            });
          }}
        />
      }
    />
  );
}
