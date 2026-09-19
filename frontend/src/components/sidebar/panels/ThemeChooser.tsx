import { Check } from "lucide-react";
import { useThemePreferences } from "../../../themePreferences";
import { SectionHeader } from "../../../ui";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import classes from "./ThemeChooser.module.css";

/**
 * The four schemes, as a radio group of swatch cards — the same shape as Logjam
 * GPS's Display screen, and local to this page on both clients rather than in
 * the kit: a card that shows three of a scheme's tokens means nothing anywhere
 * else.
 *
 * NATIVE RADIOS, so the group is one tab stop and the arrow keys move the
 * choice. It was a row of `aria-pressed` buttons, which is four tab stops and
 * announces four separate toggles rather than one choice of four.
 *
 * The web applies a scheme as it is picked, so there is no "next time you open"
 * note here — the phone needs one because its native shell reads the palette at
 * launch.
 */
function ThemeChooser() {
  const { schemeId, schemes, isHydrating, isSaving, error, setThemeScheme } =
    useThemePreferences();

  return (
    <>
      <SectionHeader title="Theme" />
      {error && <ErrorBanner message={error} />}
      {isHydrating ? (
        <p className={classes.state}>Loading your saved theme…</p>
      ) : (
        <div className={classes.group} role="radiogroup" aria-label="Theme">
          {schemes.map((scheme) => {
            const selected = scheme.id === schemeId;
            return (
              <label key={scheme.id} className={classes.scheme} data-selected={selected || undefined}>
                <input
                  type="radio"
                  name="theme-scheme"
                  className="visually-hidden"
                  value={scheme.id}
                  checked={selected}
                  disabled={isSaving}
                  onChange={() => setThemeScheme(scheme.id)}
                />
                <span className={classes.swatches} aria-hidden>
                  {[scheme.tokens.primary, scheme.tokens.secondary, scheme.tokens.accent].map(
                    (colour) => (
                      <span
                        key={colour}
                        className={classes.swatch}
                        style={{ backgroundColor: colour }}
                      />
                    ),
                  )}
                </span>
                <span className={classes.name}>{scheme.name}</span>
                {selected && <Check size={16} className={classes.tick} aria-hidden />}
              </label>
            );
          })}
        </div>
      )}
    </>
  );
}

export default ThemeChooser;
