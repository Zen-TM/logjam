// A plan place, read: what it is, where, its notes and who added it. Opened
// from a place row on the plan's On the map and from its pin in plan mode
// (design §8). Read-only here: a plan place is edited in the plan, not saved
// over the caller's own, and works offline from the cached plan.
import { Clipboard, Text, View } from "react-native";
import {
  formatElevationM,
  SYSTEM_PLACE_TYPES,
  tripPlanAddedByLine,
  type TripPlanPlace,
} from "@logjam/shared";

import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, Row } from "../ui";

export function PlanPlaceSheet({
  place,
  onClose,
}: {
  /** The place shown; null while the sheet is closed. */
  place: TripPlanPlace | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  const type = SYSTEM_PLACE_TYPES.find(
    (each) => each.id === place?.placeTypeId,
  );
  const position = place
    ? `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`
    : "";
  return (
    <BottomSheet
      visible={place !== null}
      onClose={onClose}
      title={place?.name ?? ""}
    >
      {place ? (
        <View style={styles.body}>
          <Text style={styles.detail}>
            {[type?.name ?? "Place", tripPlanAddedByLine(place.addedBy)]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Row
            icon="copy"
            title={position}
            subtitle={
              place.elevation != null
                ? `Position · ${formatElevationM(place.elevation)}`
                : "Position"
            }
            // RN core Clipboard, as the place page's copy.
            onPress={() => Clipboard.setString(position)}
            accessibilityLabel={`Copy position ${position}`}
          />
          {place.notes ? (
            <Text style={styles.notes} selectable>
              {place.notes}
            </Text>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  detail: { ...muted(theme, textRole.detail) },
  notes: { ...textRole.body, color: theme.text },
}));
