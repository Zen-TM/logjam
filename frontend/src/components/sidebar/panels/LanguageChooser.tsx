import { language, LANGUAGE_SETTING, type Language } from "@logjam/shared";

import { chooseLanguage } from "../../../languageSetting";
import { ChipRail, SectionHeader } from "../../../ui";
import { useToast } from "../../feedback/ToastProvider";

/**
 * The languages Logjam Web offers, as one choice. Drawn only when there is more
 * than one (SettingsPanel.tsx), so prod, which offers the source alone, shows
 * nothing. Choosing stores it and reloads the page (languageSetting.ts).
 */
function LanguageChooser({ offered }: { offered: readonly Language[] }) {
  const toast = useToast();
  return (
    <>
      <SectionHeader title={LANGUAGE_SETTING.title} />
      <ChipRail
        label={LANGUAGE_SETTING.title}
        options={offered.map((lang) => ({
          value: lang,
          label: LANGUAGE_SETTING.names[lang],
        }))}
        value={language()}
        hint={LANGUAGE_SETTING.hint.web}
        onChange={(next) => {
          if (!chooseLanguage(next)) {
            toast.error(LANGUAGE_SETTING.saveFailed.web);
          }
        }}
      />
    </>
  );
}

export default LanguageChooser;
