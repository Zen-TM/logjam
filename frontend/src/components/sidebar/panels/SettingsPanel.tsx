import { Fragment, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationGroupLead,
  NOTIFICATION_PREFERENCES,
  ownAttributeCountLabel,
  ownTypeCountLabel,
  SETTINGS,
  type SectionKeysOn,
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
import {
  Hero,
  IconTile,
  Row,
  SectionHeader,
  SwitchRow,
  Icon,
  LoadingState,
} from "../../../ui";
import CustomFieldSection from "./CustomFieldSection";
import PlaceTypeSection from "./PlaceTypeSection";
import ThemeChooser from "./ThemeChooser";
import classes from "./SettingsPanel.module.css";

/** A page inside Settings: a list you keep, rather than a preference you set. */
type ListPage = "placeTypes" | "tripAttributes" | "placeAttributes";

/**
 * Settings — how the app behaves, and the lists the user keeps.
 *
 * NO HERO (docs/ux-principles.md §2): there is nothing to headline. A hero whose only
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
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(
    null,
  );
  // WHICH switch is in flight, not THAT one is: a single boolean disabled all
  // five for the length of the request, and five switches greying and
  // un-greying together reads as the whole list flickering.
  const [notifSavingKey, setNotifSavingKey] = useState<
    keyof NotificationPreferences | null
  >(null);
  const [autoDownloadGeoPdfs, setAutoDownloadGeoPdfs] = useState<
    boolean | null
  >(null);
  const [autoDownloadSaving, setAutoDownloadSaving] = useState(false);

  // Seeded from the signed-in user, during render, each time that changes.
  // `null` until the first render has done so.
  const userId = currentUser?.id;
  const [seededFor, setSeededFor] = useState<string | undefined | null>(null);
  if (userId !== seededFor) {
    setSeededFor(userId);
    if (currentUser) {
      setNotifPrefs({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...(currentUser.uiPreferences?.notifications ?? {}),
      });
      setAutoDownloadGeoPdfs(
        currentUser.uiPreferences?.autoDownloadGeoPdfs ?? true,
      );
    }
  }

  /** Optimistic, and put back on failure: a switch is the kind of control whose
   *  whole point is that it answers the press. */
  async function handleToggleNotif(key: keyof NotificationPreferences) {
    if (!notifPrefs) return;
    const previous = notifPrefs;
    const next = { ...notifPrefs, [key]: !notifPrefs[key] };
    setNotifPrefs(next);
    setNotifSavingKey(key);
    try {
      await updateNotificationPreferences({ [key]: next[key] });
    } catch (err) {
      console.error(err);
      // Put back only the key that failed: another switch may have been
      // answered while this request was out, and `previous` is stale for it.
      setNotifPrefs((current) => ({
        ...(current ?? previous),
        [key]: previous[key],
      }));
      toast.error(
        messageFromError(err, "Couldn't save that notification setting."),
      );
    } finally {
      setNotifSavingKey((current) => (current === key ? null : current));
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
      toast.error(
        messageFromError(err, "Couldn't save that download setting."),
      );
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
        onDefsChange={
          isTrip ? onCustomFieldDefsChange : onPlaceCustomFieldDefsChange
        }
        placeTypes={isTrip ? undefined : placeTypes}
        onBack={() => setPage(null)}
      />
    );
  }

  // Exhaustive by type: a section the contract names and this panel does not
  // draw, or the reverse, fails `tsc` (`SETTINGS`, shared/src/contracts).
  const sections: Record<
    SectionKeysOn<typeof SETTINGS, "web">,
    () => ReactNode
  > = {
    preferences: () => (
      <>
        <ThemeChooser />

        <SectionHeader title="Notifications" />
        {notifPrefs === null ? (
          <LoadingState />
        ) : (
          NOTIFICATION_PREFERENCES.map(({ key, group, what }) => (
            <SwitchRow
              key={key}
              title={`${notificationGroupLead(group, "Logjam Web")} ${what}`}
              checked={notifPrefs[key]}
              disabled={notifSavingKey === key}
              onChange={() => handleToggleNotif(key)}
            />
          ))
        )}

        <SectionHeader title="Downloads" />
        {autoDownloadGeoPdfs === null ? (
          <LoadingState />
        ) : (
          <SwitchRow
            title="Download GeoPDFs automatically when they finish generating"
            checked={autoDownloadGeoPdfs}
            disabled={autoDownloadSaving}
            onChange={handleToggleAutoDownload}
          />
        )}
      </>
    ),
    categories: () => (
      <>
        {/* Types come BEFORE the attributes scoped to them: a user reading
            downwards meets the categories, then what each one records. */}
        <SectionHeader title={copy.categories} />
        <Row
          leading={<IconTile icon="place" hue="var(--color-accent)" />}
          title={copy.placeTypes}
          subtitle={ownTypeCountLabel(
            placeTypes.filter((type) => !type.isSystem).length,
          )}
          trailing={<Icon idea="disclosure" size={18} aria-hidden />}
          onOpen={() => setPage("placeTypes")}
        />
      </>
    ),
    attributes: () => (
      <>
        <SectionHeader title={copy.attributes} />
        <Row
          leading={<IconTile icon="tag" hue="var(--color-accent)" />}
          title={copy.tripAttributes}
          subtitle={ownAttributeCountLabel(ownCount(customFieldDefs))}
          trailing={<Icon idea="disclosure" size={18} aria-hidden />}
          onOpen={() => setPage("tripAttributes")}
        />
        <Row
          leading={<IconTile icon="tag" hue="var(--color-accent)" />}
          title={copy.placeAttributes}
          subtitle={ownAttributeCountLabel(ownCount(placeCustomFieldDefs))}
          trailing={<Icon idea="disclosure" size={18} aria-hidden />}
          onOpen={() => setPage("placeAttributes")}
        />
      </>
    ),
  };

  return (
    <div className={classes.page}>
      {/* Not a hero that answers a question (there is none): the title row
          every panel has, which is where its × lives. */}
      <Hero title={SETTINGS.title} />
      <div className={classes.root}>
        {contractSectionKeys(SETTINGS, "web").map((key) => (
          <Fragment key={key}>{sections[key]()}</Fragment>
        ))}
      </div>
    </div>
  );
}

const copy = SETTINGS.copy;

/** Only the user's OWN attributes are counted. */
const ownCount = (defs: ScopedCustomFieldDef[]) =>
  defs.filter((def) => def.ownerId !== null).length;

export default SettingsPanel;
