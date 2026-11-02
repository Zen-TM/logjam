// "What goes here?": the sheet a press-and-hold opens. Its rows are
// `mapHoldVerbs("gps")` and nothing else, so its words cannot drift from the
// ones Logjam Web's right-click menu draws; the `Record` below is the parity
// check, and `contracts.test.ts` holds the list.
import { View } from "react-native";
import {
  MAP_POINT,
  mapHoldVerbs,
  type MapHoldVerbId,
  type MapPointCoord,
} from "@logjam/shared";

import { spacing, makeStyles } from "../theme";
import { BottomSheet, Row } from "../ui";

export type MapHoldRun = Record<
  MapHoldVerbId<"gps">,
  (point: MapPointCoord) => void
>;

export function MapHoldSheet({
  point,
  run,
  savedHereOnly,
  onClose,
  onClosed,
}: {
  point: MapPointCoord | null;
  run: MapHoldRun;
  /** Not yet known to be synced: offline, a change queued, or no account. */
  savedHereOnly?: boolean;
  onClose: () => void;
  /** After the sheet has gone: the place form cannot open over it (a second
   *  Modal over the first does not hold focus). */
  onClosed: () => void;
}) {
  const styles = useStyles();
  return (
    <BottomSheet
      visible={point !== null}
      onClose={onClose}
      onClosed={onClosed}
      title={MAP_POINT.copy.holdTitle}
    >
      {/* The gap is the sheet-list convention (MapPointSheet, SavedScreen):
          rows flush against each other read as one slab, not separate targets. */}
      <View style={styles.body}>
        {mapHoldVerbs("gps", savedHereOnly).map((verb) => (
          <Row
            key={verb.id}
            icon={verb.icon}
            title={verb.label}
            subtitle={verb.subtitle ?? undefined}
            onPress={() => {
              if (point) run[verb.id as keyof MapHoldRun](point);
            }}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: spacing(1) },
}));
