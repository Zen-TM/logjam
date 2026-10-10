/**
 * KIT_COMPONENTS — the component list of both UI kits, declared once.
 *
 * `both` means the kit exports it on Logjam Web AND Logjam GPS, under this
 * name and with the same prop names where the concept is the same. A
 * platform-only entry says why in one line, so a missing twin is a decision
 * somebody made, never a gap nobody noticed.
 *
 * Each client's `ui/kit.test.ts` holds its barrel to EXACTLY its set (`both`
 * plus its own). A component is a PascalCase value export of the barrel; a
 * helper (a hook, a constant, a function) is not PascalCase and a type is not a
 * value, so neither is counted. A new component starts here.
 */
export type KitPlatform = "both" | "web" | "gps";

export type KitEntry =
  | { platform: "both" }
  | { platform: "web" | "gps"; reason: string };

const both: KitEntry = { platform: "both" };
const web = (reason: string): KitEntry => ({ platform: "web", reason });
const gps = (reason: string): KitEntry => ({ platform: "gps", reason });

export const KIT_COMPONENTS = {
  // — actions —
  Button: both,
  IconButton: both,
  Icon: both,
  TextLink: gps("Logjam Web writes a native anchor, styled by the page"),
  MapButton: web("floats over the map; Logjam GPS's map chrome is its own"),
  MapButtonGroup: web("one shadowed block of MapButtons"),

  // — chips and filters —
  Chip: both,
  ChipPicker: both,
  ChipRail: both,
  RangePills: both,
  AttributeFilter: both,
  DateRangeFilter: gps(
    "a date range as two bounds that open the sheet's DatePicker; Logjam Web uses two date inputs in a FilterField",
  ),
  FilterField: web(
    "a filter's label, summary and clear; Logjam GPS's sheet lays its own",
  ),

  // — rows, tiles and lists —
  Row: both,
  ListEnd: both,
  SwitchRow: both,
  SectionHeader: both,
  Avatar: both,
  IconTile: web(
    "Logjam GPS's Row draws the same tile from its icon and hue props",
  ),
  TileCheckbox: web(
    "a tile that ticks under a pointer; touch selects by press-and-hold",
  ),
  SelectionMark: gps(
    "the checkbox a row shows during a multi-select; Logjam Web uses TileCheckbox",
  ),
  SelectionBar: both,
  SettingsRow: web(
    "a setting as a line with its control; Logjam GPS composes Row and Toggle",
  ),
  InfoTip: web("a hover and focus tooltip; touch has no hover"),

  // — numbers and state —
  StatGrid: both,
  Meter: both,
  ActivitySpark: both,
  StatusPill: both,
  ProgressBar: web("Logjam GPS draws progress as Row's bottom bar"),
  ProfileChart: gps(
    "the touch-scrubbed elevation and speed chart; Logjam Web draws its profile in components/routes",
  ),
  Notice: both,
  SyncStatusPills: gps(
    "the offline and waiting-to-sync pair in every list hero; a phone is the one that goes offline",
  ),

  // — form controls —
  TextField: both,
  Field: gps(
    "a label, control, hint and error at the form rhythm; Logjam Web's TextField, Select and RangeField share one inside TextField.tsx",
  ),
  FormStack: gps(
    "a form's fields at the one field-to-field gap; Logjam Web's dialog body sets it in CSS",
  ),
  Toggle: both,
  TextArea: web("Logjam GPS's TextField takes multiline"),
  NumberField: web("Logjam GPS's TextField takes a numeric keyboard"),
  LiveNumberField: web("Logjam GPS's TextField takes a numeric keyboard"),
  RangeField: web("a slider; touch uses RangePills"),
  SearchField: web("Logjam GPS's TextField with a search keyboard"),
  Select: web("a native select; touch uses ChipRail or a sheet"),
  Checkbox: web("a native checkbox; Logjam GPS uses Toggle or a chip"),
  // One colour picker, a floating palette: Logjam GPS draws the closed-palette
  // mode (a `palette` prop); the free colour with opacity is a topo's cartography.
  ColourField: both,
  DatePicker: gps("Logjam Web uses the browser's date input"),
  RenameForm: gps("the phone's one-field rename sheet body"),

  // — surfaces —
  Hero: both,
  Dialog: web("a modal over the page; Logjam GPS's equivalent is BottomSheet"),
  SideSheet: web(
    "a sheet beside the list; Logjam GPS's equivalent is BottomSheet",
  ),
  SheetSection: web("a titled group inside a SideSheet, Popover or Dialog"),
  Popover: web("anchored to a control; Logjam GPS's equivalent is BottomSheet"),
  Menu: web("a pointer menu; Logjam GPS opens a BottomSheet of verbs"),
  Tooltip: web("a hover and focus hint; touch has no hover"),
  BottomSheet: gps(
    "a sheet that rises over the map; Logjam Web's equivalents are Dialog, SideSheet and Popover",
  ),
  Screen: gps("a page's scaffold; Logjam Web's panels have their own frame"),
  ScreenScroll: gps("a scrolling page's scaffold"),
  Toast: both,

  // — loading, empty and failed —
  EmptyState: both,
  LoadingState: both,
  ErrorState: both,
  ErrorBanner: both,
  FieldError: both,

  // — glyphs —
  NorthNeedle: web(
    "the map's north needle, a drawing Logjam GPS does not have",
  ),
} as const satisfies Record<string, KitEntry>;

export type KitComponentName = keyof typeof KIT_COMPONENTS;

/** The names a client's barrel must export, sorted. */
export function kitComponentsFor(client: "web" | "gps"): string[] {
  return Object.entries(KIT_COMPONENTS as Record<string, KitEntry>)
    .filter(
      ([, entry]) => entry.platform === "both" || entry.platform === client,
    )
    .map(([name]) => name)
    .sort();
}

/** A value export of a barrel is a component when it is PascalCase. */
export const isKitComponentName = (name: string): boolean =>
  /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(name);

/**
 * The components a barrel exports, read from its source: every PascalCase
 * VALUE in an `export { … } from` (types and `export *` do not count). Reading
 * the text keeps the test free of react-native and CSS imports.
 */
export function barrelComponents(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const names: string[] = [];
  for (const [, list] of code.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const item of list.split(",")) {
      const entry = item.trim();
      if (!entry || entry.startsWith("type ")) continue;
      const exported = entry.split(/\s+as\s+/).pop() as string;
      if (isKitComponentName(exported)) names.push(exported);
    }
  }
  return names.sort();
}
