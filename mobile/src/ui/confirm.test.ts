import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const alert = vi.fn();
vi.mock("react-native", () => ({ Alert: { alert } }));

const { confirm } = await import("./confirm");

const SRC = join(import.meta.dirname, "..");

// Files still to move to confirm(); delete an entry when its file moves.
const BASELINE: string[] = [
  "../App.tsx",
  "AppShell.tsx",
  "customFields/CustomFieldsEditor.tsx",
  "imports/ImportOptionsSheet.tsx",
  "logs/LogsScreen.tsx",
  "logs/TripOptionsSheet.tsx",
  "map/MapScreen.tsx",
  "map/RegionDownloadScreen.tsx",
  "media/MediaStrip.tsx",
  "notifications/NotificationOptionsSheet.tsx",
  "offline/RegionDownloadRow.tsx",
  "permissionAlert.ts",
  "places/fillRouteSlot.ts",
  "places/PlaceDetailScreen.tsx",
  "places/PlaceOptionsSheet.tsx",
  "places/PlacesScreen.tsx",
  "places/PlaceTypesEditor.tsx",
  "plans/FormSheet.tsx",
  "plans/PeopleView.tsx",
  "plans/PlanItemSheet.tsx",
  "plans/PlanOptionsSheet.tsx",
  "plans/PlanPreview.tsx",
  "plans/PlansScreen.tsx",
  "plans/SectionSheet.tsx",
  "routes/RouteOptionsSheet.tsx",
  "saved/SavedScreen.tsx",
  "screens/AccountScreen.tsx",
  "screens/FriendsScreen.tsx",
  "screens/NotificationsScreen.tsx",
  "screens/settings/MapSettingsScreen.tsx",
  "screens/SyncIssuesScreen.tsx",
  "sharing/FriendSharesScreen.tsx",
  "sharing/SharePanel.tsx",
  "sharing/useSharing.tsx",
  "tracks/finishRecordingPrompt.ts",
  "tracks/RecordingSheet.tsx",
  "tracks/TrackOptionsSheet.tsx",
];

const callers = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return callers(path);
    return /\.tsx?$/.test(entry.name) &&
      !/\.(test|d)\./.test(entry.name) &&
      relative(SRC, path) !== "ui/confirm.ts" &&
      readFileSync(path, "utf8").includes("Alert.alert(")
      ? [relative(SRC, path)]
      : [];
  });

const appCallers = () =>
  readFileSync(join(SRC, "..", "App.tsx"), "utf8").includes("Alert.alert(")
    ? ["../App.tsx"]
    : [];

describe("confirm", () => {
  beforeEach(() => alert.mockReset());

  const copy = {
    confirmTitle: "Delete this place?",
    confirmBody: "Its photos go too.",
    confirmLabel: "Delete",
    tone: "destructive",
  } as const;

  // Mutation: label the first button "Keep it".
  it("always draws Cancel, then the verb in the tone's style", () => {
    confirm(copy);
    const [title, body, buttons, options] = alert.mock.calls[0];
    expect([title, body]).toEqual(["Delete this place?", "Its photos go too."]);
    expect(buttons.map((b: { text: string }) => b.text)).toEqual([
      "Cancel",
      "Delete",
    ]);
    expect(buttons.map((b: { style: string }) => b.style)).toEqual([
      "cancel",
      "destructive",
    ]);
    expect(options.cancelable).toBe(true);
    confirm({ ...copy, tone: "filled" });
    expect(alert.mock.calls[1][2][1].style).toBe("default");
  });

  it("resolves true on the verb and false on Cancel or a dismissal", async () => {
    const press = (index: number) => {
      const done = confirm(copy);
      alert.mock.calls.at(-1)![2][index].onPress();
      return done;
    };
    expect(await press(1)).toBe(true);
    expect(await press(0)).toBe(false);
    const dismissed = confirm(copy);
    alert.mock.calls.at(-1)![3].onDismiss();
    expect(await dismissed).toBe(false);
  });
});

// Every Alert goes through confirm(), so Cancel is always "Cancel"
// (mobile/DESIGN.md §4). Mutation: add `Alert.alert(` to any screen outside
// the baseline, or migrate a baselined file and leave its entry.
describe("Alert.alert is called only by confirm()", () => {
  const found = [...callers(SRC), ...appCallers()].sort();

  it("is not called by a file the baseline does not list", () => {
    expect(found.filter((file) => !BASELINE.includes(file))).toEqual([]);
  });

  it("lists only files that still call it — the list only shrinks", () => {
    expect(BASELINE.filter((file) => !found.includes(file))).toEqual([]);
  });
});
