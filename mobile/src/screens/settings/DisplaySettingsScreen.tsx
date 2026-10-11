// Settings → Display: the two things that change how the whole app looks.
//
// The theme repaints the running app the moment it is picked. The text size
// applies at the NEXT LAUNCH and says so: `fontSize` is a module constant every
// style reads (DESIGN.md).
//
// The theme is the one preference here with an account copy: it is a single
// scalar with no merge hazard, and a scheme picked in a browser is what this
// phone should open in. The text size is device-only — it answers "how well can
// I read THIS screen in THIS light", which is not a fact about the user.
//
// PRIVACY: nothing here touches user data.
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  type ThemeSchemeId,
} from "@logjam/shared";

import { apiFetch } from "../../api/apiFetch";
import { useAccountState } from "../../auth/AccountStateContext";
import {
  TEXT_SCALES,
  chosenTextScale,
  persistTextScale,
  setThemeSchemeId,
  useThemeSchemeId,
  radius,
  spacing,
  withAlpha,
  type TextScale,
  makeStyles,
  useTheme,
} from "../../theme";
import type { TUser } from "../../api/types";
import {
  ScreenScroll,
  SectionHeader,
  Toast,
  type ToastMessage,
  Icon,
} from "../../ui";
import { ChoiceGroup } from "./settingsKit";

/** Chip labels for the multiplier. The number is the honest label here — a
 *  vocabulary ("Small / Medium / Large") hides that 1.0 is the OS's own size. */
const TEXT_SCALE_LABELS: Record<TextScale, string> = {
  0.9: "Smaller",
  1: "Default",
  1.15: "Large",
  1.3: "Larger",
  1.5: "Largest",
};

export function DisplaySettingsScreen() {
  const styles = useStyles();

  const { accountState } = useAccountState();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback(
    (text: string, tone: ToastMessage["tone"] = "info") => {
      setToast({ text, tone, nonce: Date.now() });
    },
    [],
  );

  const schemeId = useThemeSchemeId();

  const chooseScheme = useCallback(
    (id: ThemeSchemeId) => {
      // Device first: this repaints the app and is what makes it open in the
      // right colours with no signal, and it must not depend on the request
      // below.
      if (!setThemeSchemeId(id)) {
        notify(
          "This phone wouldn't store that theme, so it lasts until Logjam GPS closes.",
          "error",
        );
        return;
      }
      // A guest has no account copy to mirror it to, and the device copy above
      // is the one that paints the app. Attempting the PATCH would toast a
      // failure for a preference that in fact saved perfectly.
      if (accountState === "guest") return;
      apiFetch<TUser>("/users/me", {
        method: "PATCH",
        body: { themeSchemeId: id },
      }).catch((err: unknown) => {
        console.error(err);
        // True, and specific: the phone kept it, the account didn't get it.
        notify(
          "Saved on this phone, but it didn't reach your account.",
          "error",
        );
      });
    },
    [notify, accountState],
  );

  const [textScale, setTextScale] = useState<TextScale>(chosenTextScale);
  const chooseTextScale = useCallback(
    (next: TextScale) => {
      if (!persistTextScale(next)) {
        notify("This phone wouldn't store that text size.", "error");
        return;
      }
      setTextScale(next);
    },
    [notify],
  );

  return (
    <>
      <ScreenScroll>
        <SectionHeader title="Theme" />
        <View style={styles.schemes}>
          {THEME_SCHEME_ORDER.map((id) => (
            <SchemeCard
              key={id}
              schemeId={id}
              selected={id === schemeId}
              onPress={() => chooseScheme(id)}
            />
          ))}
        </View>

        <ChoiceGroup
          label="Text size"
          options={TEXT_SCALES.map((scale) => ({
            value: String(scale),
            label: TEXT_SCALE_LABELS[scale],
          }))}
          value={String(textScale)}
          onChange={(next) => chooseTextScale(Number(next) as TextScale)}
          // Only when there is something waiting.
          hint={
            textScale === chosenTextScale
              ? undefined
              : "Applies next time you open Logjam."
          }
        />
      </ScreenScroll>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

/**
 * One theme option: its name, and the three tokens that actually decide how the
 * app looks — page, card, accent. Swatches rather than a description because the
 * choice is entirely visual, and a scheme's own colours are the only honest
 * preview available on a screen painted in a different scheme.
 */
function SchemeCard({
  schemeId,
  selected,
  onPress,
}: {
  schemeId: ThemeSchemeId;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const scheme = THEME_SCHEMES[schemeId];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={scheme.name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.scheme,
        selected && styles.schemeSelected,
        pressed && styles.schemePressed,
      ]}
    >
      <View style={styles.swatches}>
        {[scheme.tokens.page, scheme.tokens.card, scheme.tokens.accent].map(
          (color) => (
            <View
              key={color}
              style={[styles.swatch, { backgroundColor: color }]}
            />
          ),
        )}
      </View>
      <Text style={styles.schemeName} numberOfLines={1}>
        {scheme.name}
      </Text>
      {selected ? <Icon idea="done" size={16} color={theme.accent} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  schemes: { gap: spacing(1) },
  scheme: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    minHeight: 56,
  },
  schemeSelected: {
    borderColor: theme.accent,
    backgroundColor: withAlpha(theme.accent, 0.1),
  },
  schemePressed: { backgroundColor: theme.cardPressed },
  swatches: { flexDirection: "row", gap: spacing(0.5) },
  // The hairline is load-bearing, not decoration: a scheme's `card` IS the
  // card colour these sit on when it is the scheme in force, so without an edge that swatch simply vanishes and
  // the scheme looks like it has two colours.
  swatch: {
    width: 18,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(theme.text, 0.2),
  },
  schemeName: { ...textRole.rowTitle, flex: 1, color: theme.text },
}));
