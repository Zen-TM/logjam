// The one Leave confirm (Logjam Web's twin is the plan page's dialog): the
// words, and "Also delete what I added" off by default. Used by the plan's ⋯,
// a card's ⋯ and bulk leave.
import { useState } from "react";
import { Text, View } from "react-native";

import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, Button, SwitchRow } from "../ui";

export type LeaveWords = {
  confirmTitle: string;
  confirmBody: string;
  confirmLabel: string;
};

export function LeaveSheet({
  words,
  choiceLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  /** The words for the switch's state (a bulk leave says what happens to
   *  what you added); null while the sheet is closed. */
  words: ((deleteAdded: boolean) => LeaveWords) | null;
  /** The "also delete what I added" switch; null where nothing was added. */
  choiceLabel: string | null;
  busy?: boolean;
  onConfirm: (deleteAdded: boolean) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const [deleteAdded, setDeleteAdded] = useState(false);
  const shown = words?.(choiceLabel !== null && deleteAdded) ?? null;
  return (
    <BottomSheet
      visible={shown !== null}
      onClose={onClose}
      onClosed={() => setDeleteAdded(false)}
      closable={!busy}
      title={shown?.confirmTitle ?? ""}
      footer={
        <Button
          label={shown?.confirmLabel ?? ""}
          loading={busy}
          onPress={() => onConfirm(choiceLabel !== null && deleteAdded)}
        />
      }
    >
      <View style={styles.body}>
        <Text style={styles.muted}>{shown?.confirmBody}</Text>
        {choiceLabel !== null ? (
          <SwitchRow
            title={choiceLabel}
            checked={deleteAdded}
            onChange={setDeleteAdded}
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1.5) },
  muted: { ...muted(theme, textRole.body) },
}));
