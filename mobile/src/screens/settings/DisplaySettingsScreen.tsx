// Settings → Display: the two things that change how the whole app looks.
//
// Both apply at the NEXT LAUNCH, and both say so. `theme` and `fontSize` are
// module constants snapshotted by ~45 `StyleSheet.create` calls at import time,
// so repainting a running app means a provider plus a style factory in every one
// of those files — a large diff across every screen already built, for a
// preference people set once (DESIGN.md §12).
//
// The theme is the one preference here with an account copy: it is a single
// scalar with no merge hazard, and a scheme picked in a browser is what this
// phone should open in. The text size is device-only — it answers "how well can
// I read THIS screen in THIS light", which is not a fact about the user.
//
// PRIVACY: nothing here touches user data.
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  THEME_SCHEMES,
  THEME_SCHEME_ORDER,
  isThemeSchemeId,
  type ThemeSchemeId,
} from "@logjam/shared";

import { apiFetch } from "../../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../../api/queries";
import { useAccountState } from "../../auth/AccountStateContext";
import {
  TEXT_SCALES,
  activeThemeSchemeId,
  chosenTextScale,
  fontSize,
  fontWeight,
  persistTextScale,
  persistThemeSchemeId,
  radius,
  spacing,
  surface,
  theme,
  withAlpha,
  type TextScale,
} from "../../theme";
import type { TUser } from "../../api/types";
import {
  ScreenScroll,
  SectionHeader,
  Toast,
  type ToastMessage,
} from "../../ui";
import { ChoiceGroup, Hint } from "./settingsKit";

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
  const { accountState } = useAccountState();
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your settings.",
    accountState !== "guest",
  );
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  const user = userQuery.data;

  // `chosenSchemeId` is what the user has SELECTED; `activeThemeSchemeId` is
  // what this launch is painted in. They differ after a change here — and also
  // after a change made in the browser since this app last started — which is
  // exactly when the "next time you open Logjam" note is true.
  const [chosenSchemeId, setChosenSchemeId] = useState<ThemeSchemeId>(activeThemeSchemeId);
  useEffect(() => {
    const accountScheme = user?.uiPreferences?.themeSchemeId;
    if (isThemeSchemeId(accountScheme)) setChosenSchemeId(accountScheme);
  }, [user?.id, user?.uiPreferences?.themeSchemeId]);

  const chooseScheme = useCallback(
    (id: ThemeSchemeId) => {
      setChosenSchemeId(id);
      // Device first: this is what makes the app open in the right colours with
      // no signal, and it must not depend on the request below.
      if (!persistThemeSchemeId(id)) {
        notify("This phone wouldn't store that theme.", "error");
        return;
      }
      // A guest has no account copy to mirror it to, and the device copy above
      // is the one that paints the app. Attempting the PATCH would toast a
      // failure for a preference that in fact saved perfectly.
      if (accountState === "guest") return;
      apiFetch<TUser>("/users/me", { method: "PATCH", body: { themeSchemeId: id } }).catch(
        (err: unknown) => {
          console.error(err);
          // True, and specific: the phone kept it, the account didn't get it.
          notify("Saved on this phone, but it didn't reach your account.", "error");
        },
      );
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
        <SectionHeader label="Theme" />
        <View style={styles.schemes}>
          {THEME_SCHEME_ORDER.map((id) => (
            <SchemeCard
              key={id}
              schemeId={id}
              selected={id === chosenSchemeId}
              onPress={() => chooseScheme(id)}
            />
          ))}
        </View>
        {chosenSchemeId !== activeThemeSchemeId ? (
          <Hint text="Applies next time you open Logjam." />
        ) : null}

        <ChoiceGroup
          label="Text size"
          options={TEXT_SCALES.map((scale) => ({
            value: String(scale),
            label: TEXT_SCALE_LABELS[scale],
          }))}
          value={String(textScale)}
          onChange={(next) => chooseTextScale(Number(next) as TextScale)}
          // Only when there is something waiting: the same note the theme
          // above carries, for the same reason.
          hint={
            textScale === chosenTextScale ? undefined : "Applies next time you open Logjam."
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
        {[scheme.tokens.primary, scheme.tokens.secondary, scheme.tokens.accent].map(
          (color) => (
            <View key={color} style={[styles.swatch, { backgroundColor: color }]} />
          ),
        )}
      </View>
      <Text style={styles.schemeName} numberOfLines={1}>
        {scheme.name}
      </Text>
      {selected ? <Feather name="check" size={16} color={theme.accent} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  schemes: { gap: spacing(1) },
  scheme: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    minHeight: 56,
  },
  schemeSelected: {
    borderColor: theme.accent,
    backgroundColor: withAlpha(theme.accent, 0.1),
  },
  schemePressed: { backgroundColor: surface.cardPressed },
  swatches: { flexDirection: "row", gap: 3 },
  // The hairline is load-bearing, not decoration: Sandstone's `secondary` IS the
  // card colour these sit on, so without an edge that swatch simply vanishes and
  // the scheme looks like it has two colours.
  swatch: {
    width: 18,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.2),
  },
  schemeName: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
});
