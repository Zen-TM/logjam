// Whether an offline map covers a place or a way, with the one verb that saves
// one framed on it (mobile/DESIGN.md §8). Drawn on the page of the thing, so
// the answer to "will I have a map there?" is read before leaving signal.
import { useNavigation } from "@react-navigation/native";

import { unavailableReasonText } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { Button, Row } from "../ui";
import { coveredByOfflineMaps } from "./coveredByOfflineMaps";
import { useMapArtifacts } from "./useMapArtifacts";

export function MapCoverageRow({
  bbox,
  onSave,
}: {
  /** The ground to cover, `[west, south, east, north]`. */
  bbox: [number, number, number, number];
  /** Leaves the page that holds the row (a sheet closes itself). */
  onSave?: () => void;
}) {
  const navigation = useNavigation();
  const online = useConnectivity() === "online";
  const { artifacts, loaded } = useMapArtifacts();
  // Nothing until the registry is read: "no map" is not yet known to be true.
  if (!loaded) return null;

  if (coveredByOfflineMaps(bbox, artifacts))
    return <Row icon="saveOffline" title="Offline map saved for this area" />;
  return (
    <Row
      icon="saveOffline"
      title="No offline map for this area"
      subtitle={online ? undefined : unavailableReasonText("needs-connection")}
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
