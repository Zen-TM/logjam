import { useEffect, useState } from "react";
import { ChevronRight, Layers, Tag } from "lucide-react";
import {
  ATTRIBUTE_NOUN,
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationPreferences,
  type ScopedCustomFieldDef,
} from "@logjam/shared";

import {
  updateNotificationPreferences,
  updateUserPreferences,
  type TPlaceType,
  type TUser,
} from "../../../placeUtils";
import { messageFromError } from "../../../errors/messageFromError";
import { useToast } from "../../feedback/ToastProvider";
import { IconTile, Row, SectionHeader, SwitchRow } from "../../../ui";
import CustomFieldSection from "./CustomFieldSection";
import PlaceTypeSection from "./PlaceTypeSection";
import ThemeChooser from "./ThemeChooser";
import classes from "./SettingsPanel.module.css";

/** Which notification the user is switching, and the words for it. No glyph: a
 *  list of statements is not a list of objects, so one there is decoration. */
const NOTIFICATIONS: { key: keyof NotificationPreferences; title: string }[] = [
  { key: "topoEmail", title: "Email me when a topo finishes or fails" },
  { key: "exportEmail", title: "Email me when a topo export finishes or fails" },
  { key: "geoPdfEmail", title: "Email me when a GeoPDF finishes or fails" },
  { key: "friendRequestInApp", title: "Tell me here about friend requests" },
  { key: "shareInApp", title: "Tell me here when something is shared with me" },
];

/** A page inside Settings: a list you keep, rather than a preference you set. */
type ListPage = "placeTypes" | "tripAttributes" | "placeAttributes";

/**
 * Settings — how the app behaves, and the lists the user keeps.
 *
 * NO HERO (DESIGN.md §1): there is nothing to headline. A hero whose only
 * content is the word "Settings" is exactly the pattern the hero rule replaces,
 * and Logjam GPS's settings screen makes the same call.
 *
 * The three LISTS are pages of their own, reached from a row that carries the
 * count and returned from by the arrow in their hero (§2's step-inside-a-view).
 * Inline they were 18 rows of attributes under two rows of preferences, so the
 * settings this page exists for sat above a list nobody scrolled to the end of
 * — and "what am I keeping" is the question the count answers without opening
 * anything.
 */
function SettingsPanel({
  currentUser,
  customFieldDefs,
  onCustomFieldDefsChange,
  placeCustomFieldDefs,
  onPlaceCustomFieldDefsChange,
  placeTypes,
  onPlaceTypesChange,
}: {
  currentUser: TUser | null;
  // Custom trip-log field definitions (App-level state, shared with the trip
  // dialogs so a create/rename/delete here is immediately visible there).
  customFieldDefs: ScopedCustomFieldDef[];
  onCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  // Custom place field definitions (App-level state, shared with PlaceDialog).
  placeCustomFieldDefs: ScopedCustomFieldDef[];
  onPlaceCustomFieldDefsChange: (defs: ScopedCustomFieldDef[]) => void;
  /** Offered as the scoping choice when a PLACE attribute is created here, and
   *  managed by the page below. */
  placeTypes: TPlaceType[];
  onPlaceTypesChange: (types: TPlaceType[]) => void;
}) {
  const toast = useToast();
  const [page, setPage] = useState<ListPage | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(null);
  const [notifSaving, setNotifSaving] = useState(false);
  const [autoDownloadGeoPdfs, setAutoDownloadGeoPdfs] = useState<boolean | null>(null);
  const [autoDownloadSaving, setAutoDownloadSaving] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setNotifPrefs({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(currentUser.uiPreferences?.notifications ?? {}),
    });
    setAutoDownloadGeoPdfs(currentUser.uiPreferences?.autoDownloadGeoPdfs ?? true);
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Optimistic, and put back on failure: a switch is the kind of control whose
   *  whole point is that it answers the press. */
  async function handleToggleNotif(key: keyof NotificationPreferences) {
    if (!notifPrefs) return;
    const previous = notifPrefs;
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    setNotifSaving(true);
    try {
      await updateNotificationPreferences({ [key]: next[key] });
    } catch (err) {
      console.error(err);
      setNotifPrefs(previous);
      toast.error(messageFromError(err, "Couldn't save that notification setting."));
    } finally {
      setNotifSaving(false);
    }
  }

  async function handleToggleAutoDownload() {
    if (autoDownloadGeoPdfs === null) return;
    const previous = autoDownloadGeoPdfs;
    const next = !autoDownloadGeoPdfs;
    setAutoDownloadGeoPdfs(next);
    setAutoDownloadSaving(true);
    try {
      await updateUserPreferences({ autoDownloadGeoPdfs: next });
    } catch (err) {
      console.error(err);
      setAutoDownloadGeoPdfs(previous);
      toast.error(messageFromError(err, "Couldn't save that download setting."));
    } finally {
      setAutoDownloadSaving(false);
    }
  }

  if (page === "placeTypes") {
    return (
      <PlaceTypeSection
        types={placeTypes}
        loading={!currentUser}
        onTypesChange={onPlaceTypesChange}
        onBack={() => setPage(null)}
      />
    );
  }

  if (page === "tripAttributes" || page === "placeAttributes") {
    const isTrip = page === "tripAttributes";
    return (
      <CustomFieldSection
        entity={isTrip ? "trip-log" : "place"}
        title={isTrip ? "Trip attributes" : "Place attributes"}
        rowNoun={isTrip ? "trip" : "place"}
        loading={!currentUser}
        defs={isTrip ? customFieldDefs : placeCustomFieldDefs}
        onDefsChange={isTrip ? onCustomFieldDefsChange : onPlaceCustomFieldDefsChange}
        placeTypes={isTrip ? undefined : placeTypes}
        onBack={() => setPage(null)}
      />
    );
  }

  return (
    <div className={classes.root}>
      <ThemeChooser />

      <SectionHeader title="Notifications" />
      {notifPrefs === null ? (
        <p className={classes.state}>Loading…</p>
      ) : (
        NOTIFICATIONS.map(({ key, title }) => (
          <SwitchRow
            key={key}
            title={title}
            checked={notifPrefs[key]}
            disabled={notifSaving}
            onChange={() => handleToggleNotif(key)}
          />
        ))
      )}

      <SectionHeader title="Downloads" />
      {autoDownloadGeoPdfs === null ? (
        <p className={classes.state}>Loading…</p>
      ) : (
        <SwitchRow
          title="Save a GeoPDF as soon as it is made"
          description="This browser only."
          checked={autoDownloadGeoPdfs}
          disabled={autoDownloadSaving}
          onChange={handleToggleAutoDownload}
        />
      )}

      {/* Types come BEFORE the attributes scoped to them: a user reading
          downwards meets the categories, then what each one records. */}
      <SectionHeader title="Your own categories" />
      <Row
        leading={<IconTile icon={Layers} hue="var(--theme-accent)" />}
        title="Place types"
        subtitle={ownTypeCountLabel(placeTypes)}
        trailing={<ChevronRight size={18} aria-hidden />}
        onOpen={() => setPage("placeTypes")}
      />

      <SectionHeader title={`Your own ${ATTRIBUTE_NOUN.many}`} />
      <Row
        leading={<IconTile icon={Tag} hue="var(--theme-accent)" />}
        title="Trip attributes"
        subtitle={attributeCountLabel(customFieldDefs)}
        trailing={<ChevronRight size={18} aria-hidden />}
        onOpen={() => setPage("tripAttributes")}
      />
      <Row
        leading={<IconTile icon={Tag} hue="var(--theme-accent)" />}
        title="Place attributes"
        subtitle={attributeCountLabel(placeCustomFieldDefs)}
        trailing={<ChevronRight size={18} aria-hidden />}
        onOpen={() => setPage("placeAttributes")}
      />
    </div>
  );
}

/** Only the user's OWN types are counted: "4 types" for an account that has
 *  made none reads as a list they are already keeping. */
function ownTypeCountLabel(types: TPlaceType[]): string {
  const own = types.filter((type) => !type.isSystem).length;
  if (own === 0) return "Built-ins only";
  return `${own} of your own`;
}

function attributeCountLabel(defs: ScopedCustomFieldDef[]): string {
  const own = defs.filter((def) => def.ownerId !== null).length;
  if (own === 0) return "None yet";
  return `${own} ${own === 1 ? ATTRIBUTE_NOUN.one : ATTRIBUTE_NOUN.many}`;
}

export default SettingsPanel;
