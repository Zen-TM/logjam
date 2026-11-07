// "Where do you canyon?": the step after the terms of a new account. Shown by
// `ConsentGate` when it records the terms, and by `AppShell` right after Logjam
// GPS's own sign-up form, which records them itself (`showsRegionStepAfterSignIn`).
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { REGION_CHOICE, REGIONS, type Region } from "@logjam/shared";

import type { AccountState } from "../auth/capabilities";
import { useConnectivity } from "../map/connectivity";
import { chooseRegions, useRegionsSending } from "../regionsPreference";
import { makeStyles, spacing } from "../theme";
import { Button, ErrorBanner } from "../ui";
import { RegionSwitches } from "./RegionSwitches";
import {
  regionContinueProps,
  regionStepPress,
  sendsRegionChoice,
} from "./regionChoice";

export function RegionStep({
  accountState,
  onDone,
  regions = REGIONS,
}: {
  accountState: AccountState;
  onDone: () => void;
  /** Every region on offer; a prop so a test can give the step two. */
  regions?: readonly Region[];
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const online = useConnectivity() === "online";
  const sending = useRegionsSending();
  // None chosen at first: a new account that taps Continue must have chosen.
  const [chosen, setChosen] = useState<string[]>([]);
  const [banner, setBanner] = useState<{
    message: string;
    retry: boolean;
  } | null>(null);

  const send = async () => {
    const press = regionStepPress(chosen);
    if ("explain" in press) {
      setBanner({ message: press.explain, retry: false });
      return;
    }
    setBanner(null);
    if (await chooseRegions(chosen, sendsRegionChoice(accountState, online))) {
      onDone();
    } else setBanner({ message: REGION_CHOICE.saveFailed, retry: true });
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + spacing(3),
          paddingBottom: insets.bottom + spacing(3),
        },
      ]}
    >
      <Text style={styles.title}>{REGION_CHOICE.title}</Text>
      <Text style={styles.body}>{REGION_CHOICE.hint}</Text>
      <RegionSwitches
        chosen={chosen}
        onChange={(next) => {
          setChosen(next);
          setBanner(null);
        }}
        disabled={sending}
        regions={regions}
      />
      {banner ? (
        <ErrorBanner
          message={banner.message}
          onRetry={banner.retry ? send : undefined}
        />
      ) : null}
      <Button {...regionContinueProps(sending, send)} />
    </ScrollView>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  root: { flex: 1, backgroundColor: theme.page },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing(3),
    gap: spacing(2),
  },
  title: { ...textRole.title, color: theme.text },
  body: { ...textRole.paragraph, color: theme.text },
}));
