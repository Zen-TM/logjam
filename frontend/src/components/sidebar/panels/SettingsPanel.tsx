import { Fragment, useId, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  DEFAULT_NOTIFICATION_PREFERENCES,
  COPY_MEDIA_SETTING,
  LEADERBOARD_SETTING,
  normalizeUserUiPreferences,
  notificationGroupLead,
  NOTIFICATION_PREFERENCES,
  offersRegionChoice,
  ownAttributeCountLabel,
  ownTypeCountLabel,
  REGION_CHOICE,
  regionOffRefusal,
  REGIONS,
  SETTINGS,
  toggleRegion,
  type Region,
  type SectionKeysOn,
  type NotificationPreferenceGroup,
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
  ErrorState,
  LoadingState,
} from "../../../ui";
import CustomFieldSection from "./CustomFieldSection";
import PlaceTypeSection from "./PlaceTypeSection";
import ThemeChooser from "./ThemeChooser";
import classes from "./SettingsPanel.module.css";

/** A page inside Settings: a list you keep, rather than a preference you set. */
type ListPage = "placeTypes" | "tripAttributes" | "placeAttributes";

/**
 * Settings — how Logjam Web behaves, and the lists the user keeps.
 *
 * NO HERO (shared/DESIGN.md §2): there is nothing to headline. A hero whose only
 * content is the word "Settings" is exactly the pattern the hero rule replaces,
 * and Logjam GPS's settings screen makes the same call.
 *
 * The three LISTS are pages of their own, reached from a row that carries the
 * count and returned from by the arrow in their hero (§2's step-inside-a-view).
 * Inline they would be 18 rows of attributes under two rows of preferences, so
 * the settings this page exists for would sit above a list nobody scrolls to the
 * end of — and "what am I keeping" is the question the count answers without
 * opening anything.
 */
function SettingsPanel({
  currentUser,
  currentUserError,
  onRetryCurrentUser,
  customFieldDefs,
  onCustomFieldDefsChange,
  placeCustomFieldDefs,
  onPlaceCustomFieldDefsChange,
  placeTypes,
  onPlaceTypesChange,
  onCurrentUserChange,
  regions = REGIONS,
}: {
  currentUser: TUser | null;
  /** Our sentence for an account load that failed; settings have nothing to show without it. */
  currentUserError: string | null;
  onRetryCurrentUser: () => void;
  /** The saved user, so what reads it elsewhere (Friends' leaderboard button)
   *  follows a switch here without a reload. */
  onCurrentUserChange: (user: TUser) => void;
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
  /** The regions to offer; only a test passes more than the real ones. */
  regions?: readonly Region[];
}) {
  const toast = useToast();
  const [page, setPage] = useState<ListPage | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences | null>(
    null,
  );
  // WHICH switch is in flight, not THAT one is: a single boolean would disable
  // all four for the length of the request, and four switches greying and
  // un-greying together reads as the whole list flickering.
  const [notifSavingKey, setNotifSavingKey] = useState<
    keyof NotificationPreferences | null
  >(null);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState<boolean | null>(
    null,
  );
  const [leaderboardSaving, setLeaderboardSaving] = useState(false);
  const [copyMedia, setCopyMedia] = useState<boolean | null>(null);
  const [copyMediaSaving, setCopyMediaSaving] = useState(false);
  const [chosenRegions, setChosenRegions] = useState<string[] | null>(null);
  const [regionsSaving, setRegionsSaving] = useState(false);

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
      setLeaderboardOptIn(currentUser.uiPreferences?.leaderboardOptIn ?? false);
      // On unless the account says otherwise, as the server reads it.
      setCopyMedia(currentUser.uiPreferences?.copyPlaceMedia ?? true);
      setChosenRegions(
        normalizeUserUiPreferences(currentUser.uiPreferences).regions,
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

  async function handleToggleLeaderboard() {
    if (leaderboardOptIn === null) return;
    const previous = leaderboardOptIn;
    const next = !leaderboardOptIn;
    setLeaderboardOptIn(next);
    setLeaderboardSaving(true);
    try {
      onCurrentUserChange(
        await updateUserPreferences({ leaderboardOptIn: next }),
      );
      toast.done(next ? LEADERBOARD_SETTING.joined : LEADERBOARD_SETTING.left);
    } catch (err) {
      console.error(err);
      setLeaderboardOptIn(previous);
      toast.error(messageFromError(err, LEADERBOARD_SETTING.saveFailed));
    } finally {
      setLeaderboardSaving(false);
    }
  }

  async function handleToggleCopyMedia() {
    if (copyMedia === null) return;
    const previous = copyMedia;
    setCopyMedia(!previous);
    setCopyMediaSaving(true);
    try {
      onCurrentUserChange(
        await updateUserPreferences({ copyPlaceMedia: !previous }),
      );
    } catch (err) {
      console.error(err);
      setCopyMedia(previous);
      toast.error(messageFromError(err, COPY_MEDIA_SETTING.saveFailed));
    } finally {
      setCopyMediaSaving(false);
    }
  }

  async function handleToggleRegion(id: string) {
    if (chosenRegions === null) return;
    const previous = chosenRegions;
    const next = toggleRegion(previous, id, regions);
    setChosenRegions(next);
    setRegionsSaving(true);
    try {
      onCurrentUserChange(await updateUserPreferences({ regions: next }));
    } catch (err) {
      console.error(err);
      setChosenRegions(previous);
      toast.error(messageFromError(err, REGION_CHOICE.saveFailed));
    } finally {
      setRegionsSaving(false);
    }
  }

  if (page === "placeTypes") {
    return (
      <PlaceTypeSection
        types={placeTypes}
        loading={!currentUser}
        onTypesChange={onPlaceTypesChange}
        placeDefs={placeCustomFieldDefs}
        onPlaceDefsChange={onPlaceCustomFieldDefsChange}
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

  /** What an account-backed section shows while the account has not loaded:
   *  our sentence and a retry. */
  const accountBlock = (content: ReactNode) =>
    !currentUser && currentUserError ? (
      <ErrorState message={currentUserError} onRetry={onRetryCurrentUser} />
    ) : (
      content
    );

  // Exhaustive by type: a section the contract names and this panel does not
  // draw, or the reverse, fails `tsc` (`SETTINGS`, shared/src/contracts).
  const sections: Record<
    SectionKeysOn<typeof SETTINGS, "web">,
    () => ReactNode
  > = {
    display: () => (
      <>
        <SectionHeader title={copy.display} />
        <ThemeChooser />
      </>
    ),
    regions: () =>
      offersRegionChoice(regions) ? (
        <>
          <SectionHeader title={copy.regions} />
          <p className={classes.lead}>{REGION_CHOICE.hint}</p>
          {chosenRegions === null ? (
            <LoadingState />
          ) : (
            regions.map((region) => {
              const on = chosenRegions.includes(region.id);
              const refused = regionOffRefusal(chosenRegions, region.id);
              return (
                <SwitchRow
                  key={region.id}
                  title={region.name}
                  checked={on}
                  // One at a time: a failed save rolls back to the choice before
                  // it, which would undo a toggle made mid-save.
                  disabled={regionsSaving || refused !== null}
                  disabledReason={refused ?? "Saving…"}
                  onChange={() => handleToggleRegion(region.id)}
                />
              );
            })
          )}
        </>
      ) : null,
    notifications: () => (
      <>
        <SectionHeader title={copy.notifications} />
        {accountBlock(
          // A lead per group, as Logjam GPS draws them: the lead is the
          // sentence's start, so each switch's label stays short.
          notifPrefs === null ? (
            <LoadingState />
          ) : (
            NOTIFICATION_GROUPS.map((group) => (
              <Group
                key={group}
                lead={notificationGroupLead(group, "Logjam Web")}
              >
                {NOTIFICATION_PREFERENCES.filter(
                  (row) => row.group === group,
                ).map(({ key, label }) => (
                  <SwitchRow
                    key={key}
                    title={label}
                    checked={notifPrefs[key]}
                    disabled={notifSavingKey === key}
                    disabledReason="Saving…"
                    onChange={() => handleToggleNotif(key)}
                  />
                ))}
              </Group>
            ))
          ),
        )}
      </>
    ),
    privacy: () => (
      <>
        <SectionHeader title={copy.privacy} />
        {/* The failed account is reported once, under Notifications. */}
        {currentUser || !currentUserError ? (
          <>
            <Group lead={copy.copying}>
              {copyMedia === null ? (
                <LoadingState />
              ) : (
                <SwitchRow
                  title={COPY_MEDIA_SETTING.label}
                  description={COPY_MEDIA_SETTING.hint}
                  checked={copyMedia}
                  disabled={copyMediaSaving}
                  disabledReason="Saving…"
                  onChange={handleToggleCopyMedia}
                />
              )}
            </Group>
            <Group lead={copy.friends}>
              {leaderboardOptIn === null ? (
                <LoadingState />
              ) : (
                <SwitchRow
                  title={LEADERBOARD_SETTING.label}
                  description={LEADERBOARD_SETTING.hint}
                  checked={leaderboardOptIn}
                  disabled={leaderboardSaving}
                  disabledReason="Saving…"
                  onChange={handleToggleLeaderboard}
                />
              )}
            </Group>
          </>
        ) : null}
        {/* The closing note, where Logjam GPS ends this page with what is kept
            on the phone. */}
        <p className={classes.privacy}>
          Only you see your places unless you share one with a friend. Nothing
          here leaves your account. Read the{" "}
          <a
            className={classes.privacyLink}
            href="/tos.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms
          </a>{" "}
          and{" "}
          <a
            className={classes.privacyLink}
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy policy
          </a>
          .
        </p>
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

/** A labelled run of rows under a lead line. Not a heading: the section's
 *  title is the heading, and a second one at its level would flatten the page. */
function Group({ lead, children }: { lead: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={classes.group}>
      <p id={id} className={classes.lead}>
        {lead}
      </p>
      {children}
    </div>
  );
}

const NOTIFICATION_GROUPS = [
  "email",
  "inApp",
] as const satisfies readonly NotificationPreferenceGroup[];

/** The user's own attributes: a system one has no owner. */
const ownCount = (defs: ScopedCustomFieldDef[]) =>
  defs.filter((def) => def.ownerId !== null).length;

export default SettingsPanel;
