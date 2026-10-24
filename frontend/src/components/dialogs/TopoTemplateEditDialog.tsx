import { useId, useState } from "react";
import { apiFetch } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import {
  RASTER_TEMPLATE_DEFAULTS,
  cloneRasterTemplateSettings,
  slopeBandsError,
  hillshadeSettingsError,
  type RasterTemplateSettings,
} from "@logjam/shared";
import { Button, ChipRail, Dialog, TextField, ErrorBanner } from "../../ui";
import AdvancedSettings from "./topoSettings/AdvancedSettings";
import { SETTINGS_TABS, type SettingsTab } from "./topoSettings/settingsTabs";
import type { TopoTemplate } from "./TopoDialog";

type Props = {
  open: boolean;
  onClose: () => void;
  editingTemplate: TopoTemplate | null;
  onSaved: () => void;
};

/**
 * The settings a topo is made with, saved under a name to make the next one the
 * same way. The form mounts on open, so a reopened dialog starts from the
 * template it is editing NOW and never from the last one's typing.
 */
export default function TopoTemplateEditDialog({
  open,
  ...form
}: Props): React.JSX.Element | null {
  return open ? <TemplateForm {...form} /> : null;
}

function TemplateForm({
  onClose,
  editingTemplate,
  onSaved,
}: Omit<Props, "open">) {
  const formId = useId();
  const [name, setName] = useState(editingTemplate?.name ?? "");
  const [settings, setSettings] = useState<RasterTemplateSettings>(() =>
    cloneRasterTemplateSettings(
      editingTemplate?.config ?? RASTER_TEMPLATE_DEFAULTS,
    ),
  );
  const [tab, setTab] = useState<SettingsTab>("hillshade");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [nameError, setNameError] = useState<string | null>(null);

  // The same shared checks the settings themselves report against, so a save
  // never reaches the server with something it would refuse.
  const settingsInvalid =
    slopeBandsError(settings.slope.bands) != null ||
    hillshadeSettingsError(settings.hillshade) != null;

  async function handleSave() {
    const trimmed = name.trim();
    if (saving) return;
    if (!trimmed) {
      setNameError("Name this template first.");
      return;
    }
    if (settingsInvalid) {
      setError("A setting needs fixing before this can be saved.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(
        editingTemplate
          ? `/topo-templates/${editingTemplate.id}`
          : "/topo-templates",
        {
          method: editingTemplate ? "PATCH" : "POST",
          body: { name: trimmed, config: settings },
        },
      );
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't save template. Please try again."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={editingTemplate ? "Edit template" : "New template"}
      size="large"
      dismissible={!saving}
      onClose={onClose}
      // Pinned: the name is what the whole dialog is about and the rail says
      // which group the body is showing, so neither scrolls away from it.
      // A real form, so Enter in the name field saves.
      toolbar={
        <>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <TextField
              label="Template name"
              value={name}
              error={nameError}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              data-autofocus
            />
          </form>
          <ChipRail
            label="Settings group"
            options={SETTINGS_TABS}
            value={tab}
            onChange={setTab}
          />
        </>
      }
      footer={
        <>
          <Button onClick={onClose} disabled={saving} disabledReason="Saving…">
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={saving}>
            Save
          </Button>
        </>
      }
    >
      {error && <ErrorBanner message={error} />}

      <AdvancedSettings tab={tab} value={settings} onChange={setSettings} />
    </Dialog>
  );
}
