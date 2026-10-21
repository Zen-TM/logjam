// A plan place, read: what it is, where, its attributes, its notes and who
// added it. Opened from a place row on the plan's On the map and from its pin
// in plan mode. Read-only here: a plan place is edited in the plan, not saved
// over the caller's own, and works offline from the cached plan.
import { Clipboard, Text, View } from "react-native";
import {
  attributeRows,
  formatElevationM,
  mapPointPosition,
  userFieldValues,
  PLACE_PAGE,
  SYSTEM_FIELD_DEFS,
  SYSTEM_PLACE_TYPES,
  tripPlanAddedByLine,
  type TripPlanPlace,
} from "@logjam/shared";

import { AttributeTable } from "../customFields/CustomFieldValues";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import { BottomSheet, Icon, Row, SectionHeader } from "../ui";

export function PlanPlaceSheet({
  place,
  onClose,
  onInfo,
}: {
  /** The place shown; null while the sheet is closed. */
  place: TripPlanPlace | null;
  onClose: () => void;
  onInfo: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const type = SYSTEM_PLACE_TYPES.find(
    (each) => each.id === place?.placeTypeId,
  );
  const position = place ? mapPointPosition(place) : "";
  // A plan place is always of a system type, so the system definitions
  // label its attributes.
  const attributes = place
    ? attributeRows(SYSTEM_FIELD_DEFS, userFieldValues(place.fieldValues))
    : [];
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
          <SectionHeader title={PLACE_PAGE.copy.position} />
          <Row
            icon="place"
            title={position}
            subtitle={
              place.elevation != null
                ? formatElevationM(place.elevation)
                : undefined
            }
            right={<Icon idea="copy" size={20} color={theme.textMuted} />}
            accessibilityLabel={`Copy the coordinates of ${place.name}`}
            // RN core Clipboard, as the place page's copy.
            onPress={() => {
              Clipboard.setString(position);
              onInfo(PLACE_PAGE.copy.copyPosition);
            }}
          />
          {attributes.length > 0 ? <AttributeTable rows={attributes} /> : null}
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
