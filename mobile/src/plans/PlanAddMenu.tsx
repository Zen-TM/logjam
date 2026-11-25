// The one "Add a place or way" button at the end of a plan's Map view and in
// its empty state, and the sheet of verbs it opens (`planItemAddMenu`). Logjam
// Web's twin is the Menu in frontend/src/components/plans/PlanItems.tsx. A
// chosen verb runs once the sheet has closed: a sheet can't open while this
// one is closing.
import { Fragment, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PlanItemAddVerbId } from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, Button, Row } from "../ui";
import type { PlanAddMenuView } from "./planAddMenu";

const OFFLINE = unavailableReasonText("needs-connection");

export function PlanAddMenu({
  menu,
  online,
  busy,
  onPick,
}: {
  menu: PlanAddMenuView;
  online: boolean;
  /** A verb is under way (a file importing): the button is inert, not its neighbours. */
  busy: boolean;
  onPick: (id: PlanItemAddVerbId) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const parked = useRef<(() => void) | null>(null);
  return (
    <>
      {/* The button only dims: the words go under it (ui/Button.tsx). */}
      <Button
        label={menu.label}
        icon={menu.icon}
        trailingIcon="expand"
        loading={busy}
        disabled={!online}
        disabledReason={OFFLINE}
        reasonShown
        onPress={() => setOpen(true)}
      />
      {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        onClosed={() => {
          const run = parked.current;
          parked.current = null;
          run?.();
        }}
        title={menu.label}
      >
        <View style={styles.verbs}>
          {menu.rows.map(({ verb, ruled }) => (
            <Fragment key={verb.id}>
              {ruled ? <View style={styles.rule} /> : null}
              <Row
                icon={verb.icon}
                title={verb.label}
                subtitle={verb.disabledReason}
                disabled={verb.disabledReason != null}
                onPress={() => {
                  parked.current = () => onPick(verb.id);
                  setOpen(false);
                }}
              />
            </Fragment>
          ))}
        </View>
      </BottomSheet>
    </>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  verbs: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
}));
