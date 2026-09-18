// Settings — the menu of preference pages, plus the two things that are lists
// rather than settings (your own fields) and the version.
//
// WHY PAGES RATHER THAN ONE LIST: this was a single scroll of six sections, and
// it mixed two kinds of preference with different failure modes. Theme, app lock
// and compass are DEVICE prefs — synchronous, no account, no signal needed.
// Notifications live on the user record, so they need both, and every one of
// those rows had to carry its own "Needs an account" subtitle to say so. Split
// by page, each page is one backend and can state that once (see
// `NotificationSettingsScreen`). Custom-field definitions are DEVICE-side too:
// they are rows in the local mirror written through the outbox
// (`customFields/fieldDefsStore.ts`), so those rows never gate on anything —
// they used to gate on connection, back when an account's list lived on the
// user record.
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
// PRIVACY: nothing here reads place data.
import { useCallback, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ATTRIBUTE_NOUN, type ScopedCustomFieldDef } from "@logjam/shared";

import { type CustomFieldEntity } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityRowProps } from "../auth/capabilities";
import { CLIENT_VERSION } from "../config";
import {
  CustomFieldList,
  useCustomFieldForm,
} from "../customFields/CustomFieldsEditor";
import { useFieldDefs } from "../customFields/useFieldDefs";
import {
  isSystemPlaceType,
  PlaceTypeList,
  usePlaceTypeForm,
} from "../places/PlaceTypesEditor";
import { useMirrorPlaceTypes } from "../sync/useSyncQueries";
import type { MirrorPlaceType } from "../sync/mirrorStore";
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
  | { kind: "fieldForm"; entity: CustomFieldEntity; editing: ScopedCustomFieldDef | null }
  | { kind: "placeTypes" }
  | { kind: "placeTypeForm"; editing: MirrorPlaceType | null };

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
  const placeFields = useFieldDefs("place");

  const defsFor = (entity: CustomFieldEntity) =>
    entity === "tripLog" ? tripFields.defs : placeFields.defs;
  const setDefsFor = (entity: CustomFieldEntity, next: ScopedCustomFieldDef[]) => {
    if (entity === "tripLog") tripFields.setDefs(next);
    else placeFields.setDefs(next);
  };

  const placeTypes = useMirrorPlaceTypes();
  const placeTypeForm = usePlaceTypeForm({
    editing: sheet.kind === "placeTypeForm" ? sheet.editing : null,
    onSaved: (message) => notify(message),
    onDone: () => setSheet({ kind: "placeTypes" }),
  });

  // Called unconditionally — it is a hook. The entity it is bound to is
  // whichever list is open; with the sheet closed the values are unused.
  const formEntity =
    sheet.kind === "fields" || sheet.kind === "fieldForm" ? sheet.entity : "place";
  const fieldForm = useCustomFieldForm({
    entity: formEntity,
    defs: defsFor(formEntity),
    editing: sheet.kind === "fieldForm" ? sheet.editing : null,
    onSaved: (next, message) => {
      setDefsFor(formEntity, next);
      notify(message);
    },
    onDone: () => setSheet({ kind: "fields", entity: formEntity }),
  });

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

        {/* A list you keep, not a preference you set — which is why the LIST
            sits here with the attribute lists. The form is also one tap from
            the Places tab's type rail ("New type", the chip at the end of it),
            because that is where a user notices they want another one; editing
            and deleting stay here, with the list of them. */}
        <SectionHeader label="Your own categories" />
        <Row
          icon="layers"
          title="Place types"
          subtitle={placeTypeCountLabel(placeTypes.data ?? [])}
          onPress={() => setSheet({ kind: "placeTypes" })}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />

        <SectionHeader label="Your own attributes" />
        <Row
          icon="tag"
          title="Trip attributes"
          subtitle={fieldCountLabel(tripFields.defs.length)}
          onPress={() => setSheet({ kind: "fields", entity: "tripLog" })}
          right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
        />
        <Row
          icon="tag"
          title="Place attributes"
          subtitle={fieldCountLabel(placeFields.defs.length)}
          onPress={() => setSheet({ kind: "fields", entity: "place" })}
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
        // A sub-mode gets an arrow back to the list it came from, rather than
        // only a button at the far end of a scroll.
        onBack={
          sheet.kind === "fieldForm"
            ? () => setSheet({ kind: "fields", entity: sheet.entity })
            : sheet.kind === "placeTypeForm"
              ? () => setSheet({ kind: "placeTypes" })
              : undefined
        }
        footer={
          sheet.kind === "placeTypeForm" ? (
            placeTypeForm.footer
          ) : sheet.kind === "placeTypes" ? (
            <Button
              label="Add a place type"
              icon="plus"
              onPress={() => setSheet({ kind: "placeTypeForm", editing: null })}
            />
          ) : sheet.kind === "fieldForm" ? (
            fieldForm.footer
          ) : sheet.kind === "fields" ? (
            // PINNED, not the last row of the list: "add" is what this screen is
            // for, and a list long enough to need scrolling is exactly the list
            // you came here to add to.
            <Button
              label={ATTRIBUTE_NOUN.add}
              icon="plus"
              onPress={() => setSheet({ kind: "fieldForm", entity: sheet.entity, editing: null })}
            />
          ) : null
        }
      >
        {sheet.kind === "fields" ? (
          <CustomFieldList
            entity={sheet.entity}
            defs={defsFor(sheet.entity)}
            onEdit={(def) =>
              setSheet({ kind: "fieldForm", entity: sheet.entity, editing: def })
            }
          />
        ) : null}
        {sheet.kind === "fieldForm" ? fieldForm.body : null}
        {sheet.kind === "placeTypes" ? (
          <PlaceTypeList
            types={placeTypes.data ?? []}
            onEdit={(type) => setSheet({ kind: "placeTypeForm", editing: type })}
          />
        ) : null}
        {sheet.kind === "placeTypeForm" ? placeTypeForm.body : null}
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </>
  );
}

function sheetTitle(sheet: SheetMode): string {
  if (sheet.kind === "closed") return "";
  if (sheet.kind === "placeTypes") return "Place types";
  if (sheet.kind === "placeTypeForm") {
    return sheet.editing ? sheet.editing.name : "New place type";
  }
  const noun = sheet.entity === "tripLog" ? "Trip" : "Place";
  if (sheet.kind === "fields") return `${noun} ${ATTRIBUTE_NOUN.many}`;
  return sheet.editing
    ? sheet.editing.label
    : `New ${noun.toLowerCase()} ${ATTRIBUTE_NOUN.one}`;
}

function fieldCountLabel(count: number): string {
  if (count === 0) return "None yet";
  return `${count} ${count === 1 ? ATTRIBUTE_NOUN.one : ATTRIBUTE_NOUN.many}`;
}

/** Only the user's OWN types are counted: "3 types" for an account that has
 *  made none reads as a list they are already keeping. */
function placeTypeCountLabel(types: MirrorPlaceType[]): string {
  const own = types.filter((type) => !isSystemPlaceType(type)).length;
  if (own === 0) return "Built-ins only";
  return `${own} of your own`;
}

const styles = StyleSheet.create({
  version: { color: theme.textMuted, fontSize: fontSize.xs },
});
