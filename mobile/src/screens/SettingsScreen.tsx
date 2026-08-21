// Settings — the menu of preference pages, plus the two things that are lists
// rather than settings (your own fields) and the version.
//
// WHY PAGES RATHER THAN ONE LIST: this was a single scroll of six sections, and
// it mixed two kinds of preference with different failure modes. Theme, app lock
// and compass are DEVICE prefs — synchronous, no account, no signal needed.
// Notifications live on the user record, so they need both, and every one of
// those rows had to carry its own "Needs an account" subtitle to say so. Split
// by page, each page is one backend and can state that once (see
// `NotificationSettingsScreen`). Custom-field definitions sit in between: an
// account's are on the user record, a guest's are on the device
// (`customFields/fieldDefsStore.ts`), so those rows gate on connection alone.
//
// LAYOUT: a plain list, so per DESIGN.md §2 it keeps `ScreenScroll` and the
// native header rather than being given a hero. There is no headline metric
// here; a hero whose only content is the word "Settings" is exactly the pattern
// the hero rule exists to replace.
//
// Row subtitles: none on the page rows (§7 — a navigation row's subtitle is live
// STATE, never an explanation of what is behind it). The field rows keep theirs
// because a count IS state, and Notifications keeps the reason slot free for
// §10's "Needs an account".
//
// PRIVACY: nothing here reads canyon data.
import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { type TripLogCustomFieldDef } from "@logjam/shared";

import { type CustomFieldEntity } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityRowProps, fieldDefsBlockedReason } from "../auth/capabilities";
import { CLIENT_VERSION } from "../config";
import { CustomFieldForm, CustomFieldList } from "../customFields/CustomFieldsEditor";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { useConnectivity } from "../map/connectivity";
import { fontSize, theme } from "../theme";
import {
  BottomSheet,
  Button,
  Row,
  ScreenScroll,
  SectionHeader,
  Toast,
  type ToastMessage,
} from "../ui";

/** The sub-pages, in the order someone goes looking for them. */
export type SettingsPage =
  | "display"
  | "map"
  | "notifications"
  | "offline"
  | "privacy";

const PAGES: {
  page: SettingsPage;
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
}[] = [
  { page: "display", icon: "type", title: "Display" },
  { page: "map", icon: "map", title: "Map" },
  { page: "notifications", icon: "bell", title: "Notifications" },
  { page: "offline", icon: "download", title: "Offline and storage" },
  { page: "privacy", icon: "lock", title: "Privacy and security" },
];

type SheetMode =
  | { kind: "closed" }
  | { kind: "fields"; entity: CustomFieldEntity }
  | { kind: "fieldForm"; entity: CustomFieldEntity; editing: TripLogCustomFieldDef | null };

export function SettingsScreen({ onOpenPage }: { onOpenPage: (page: SettingsPage) => void }) {
  const { accountState } = useAccountState();
  const online = useConnectivity() === "online";
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string, tone: ToastMessage["tone"] = "info") => {
    setToast({ text, tone, nonce: Date.now() });
  }, []);

  // ── custom fields ────────────────────────────────────────────────────────
  // Two lists rather than a page: two rows behind a chevron would be a page
  // whose whole content is the two rows above it.
  const [sheet, setSheet] = useState<SheetMode>({ kind: "closed" });
  const tripFields = useFieldDefs("tripLog");
  const canyonFields = useFieldDefs("canyon");

  const defsFor = (entity: CustomFieldEntity) =>
    entity === "tripLog" ? tripFields.defs : canyonFields.defs;
  const setDefsFor = (entity: CustomFieldEntity, next: TripLogCustomFieldDef[]) => {
    if (entity === "tripLog") tripFields.setDefs(next);
    else canyonFields.setDefs(next);
  };

  // Why the field rows can't be touched right now — offline with an account is
  // one reason, a failed account fetch another, and a dead row with no reason is
  // the state this must never render in (§8). A guest is never blocked: their
  // list is on this phone.
  const fieldsBlocked: string | undefined =
    fieldDefsBlockedReason(accountState, online) ??
    (tripFields.error ? "Couldn't reach your account" : undefined);

  return (
    <>
      <ScreenScroll>
        {PAGES.map(({ page, icon, title }) => (
          <Row
            key={page}
            icon={icon}
            title={title}
            // Notifications and Offline & Storage are account-backed pages, so
            // they say so on the way in rather than after the tap (§10). The
            // offline tab's switches all govern account-backed downloads or
            // sync, none of which a guest has.
            {...(page === "notifications"
              ? capabilityRowProps("serverPrefs", accountState, online)
              : page === "offline"
                ? capabilityRowProps("offlineSettings", accountState, online)
                : {})}
            onPress={() => onOpenPage(page)}
            right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
          />
        ))}

        <SectionHeader label="Your own fields" />
        <Row
          icon="tag"
          title="Trip fields"
          subtitle={fieldsBlocked ?? fieldCountLabel(tripFields.defs.length)}
          disabled={fieldsBlocked !== undefined}
          onPress={() => setSheet({ kind: "fields", entity: "tripLog" })}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />
        <Row
          icon="tag"
          title="Canyon fields"
          subtitle={fieldsBlocked ?? fieldCountLabel(canyonFields.defs.length)}
          disabled={fieldsBlocked !== undefined}
          onPress={() => setSheet({ kind: "fields", entity: "canyon" })}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />

        <SectionHeader label="About" />
        <Text style={styles.version}>{CLIENT_VERSION}</Text>
      </ScreenScroll>

      {/* One sheet, two modes (§6: never a second sheet — swap the content). */}
      <BottomSheet
        visible={sheet.kind !== "closed"}
        // Inside the form, a drag or a backdrop tap means "back to the list".
        onClose={() =>
          setSheet((current) =>
            current.kind === "fieldForm"
              ? { kind: "fields", entity: current.entity }
              : { kind: "closed" },
          )
        }
        title={sheetTitle(sheet)}
        footer={
          sheet.kind === "fieldForm" ? (
            // The form body carries its own save action; this is the way back.
            <Button
              label="Cancel"
              variant="outlineAccent"
              onPress={() => setSheet({ kind: "fields", entity: sheet.entity })}
            />
          ) : (
            <Button label="Done" icon="check" onPress={() => setSheet({ kind: "closed" })} />
          )
        }
      >
        {sheet.kind === "fields" ? (
          <CustomFieldList
            entity={sheet.entity}
            defs={defsFor(sheet.entity)}
            online={online}
            onAdd={() => setSheet({ kind: "fieldForm", entity: sheet.entity, editing: null })}
            onEdit={(def) =>
              setSheet({ kind: "fieldForm", entity: sheet.entity, editing: def })
            }
          />
        ) : null}
        {sheet.kind === "fieldForm" ? (
          <CustomFieldForm
            entity={sheet.entity}
            defs={defsFor(sheet.entity)}
            online={online}
            editing={sheet.editing}
            onSaved={(next, message) => {
              setDefsFor(sheet.entity, next);
              notify(message);
            }}
            onFailed={(message) => notify(message, "error")}
            onDone={() => setSheet({ kind: "fields", entity: sheet.entity })}
          />
        ) : null}
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

function sheetTitle(sheet: SheetMode): string {
  if (sheet.kind === "closed") return "";
  const noun = sheet.entity === "tripLog" ? "Trip" : "Canyon";
  if (sheet.kind === "fields") return `${noun} fields`;
  return sheet.editing ? sheet.editing.label : `New ${noun.toLowerCase()} field`;
}

function fieldCountLabel(count: number): string {
  if (count === 0) return "None yet";
  return `${count} field${count === 1 ? "" : "s"}`;
}

const styles = StyleSheet.create({
  version: { color: theme.textMuted, fontSize: fontSize.xs },
});
