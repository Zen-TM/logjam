// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");
const { builtinRules } = require("eslint/use-at-your-own-risk");

// The style properties that hold space between things. `spacing()` takes only
// the scale's steps by type; a bare number would walk round that.
const SPACING_PROPS =
  "^(gap|rowGap|columnGap|(padding|margin)(Horizontal|Vertical|Top|Bottom|Left|Right|Start|End)?)$";

// The four properties a type role owns. A number read from `fontSize` to size a
// box (the two map instruments) is geometry, not a font, and is not this.
const FONT_PROPS = "^(fontSize|fontWeight|lineHeight|fontFamily)$";

// A map label layer's text is MapLibre's own: its font and size are declared
// once, in `src/map/mapLabelText.ts`, and a layer imports them from there.
const MAP_LABEL_TEXT = {
  selector: "Property[key.name=/^(textSize|textFont)$/]",
  message:
    "A map label's font and size are declared once in src/map/mapLabelText.ts; import them there (mobile/DESIGN.md §1).",
};

const FONT_RULE = {
  selector: `Property[key.name=/${FONT_PROPS}/], Property[key.value=/${FONT_PROPS}/], JSXAttribute[name.name=/${FONT_PROPS}/]`,
  message:
    "A text style is a role: ...textRole.<name> (body, detail, meta, control, …) from makeStyles((theme, textRole) => …). A size, weight or line height is chosen in TEXT_ROLES (shared/src/designTokens.ts), never on a screen; take the role that is the text's size and weight (mobile/DESIGN.md §1).",
};

// Gotchas of Logjam GPS that a selector can hold (mobile/DESIGN.md §4, §1).
const GPS_GOTCHAS = [
  {
    selector: "JSXAttribute[name.name='autoFocus']",
    message:
      "autoFocus runs before the field is attached inside a sheet and is unreliable. Keep a ref and call .focus() in requestAnimationFrame once the sheet has opened (mobile/DESIGN.md §4).",
  },
  {
    selector:
      "CallExpression[callee.object.name='Alert'][callee.property.name='alert'][arguments.2.type='ArrayExpression'][arguments.2.elements.length>3]",
    message:
      "Android drops a fourth Alert button. A list of choices is a BottomSheet; Alert is for a destructive confirm only (mobile/DESIGN.md §4).",
  },
  {
    selector:
      "Property[key.name=/^(shadowColor|shadowOffset|shadowOpacity|shadowRadius)$/]",
    message:
      "No shadows: a sheet is the page colour sliding up and its rows are cards (mobile/DESIGN.md §1).",
  },
  {
    selector:
      "TemplateLiteral:has(MemberExpression[object.name='theme']) > TemplateElement[value.raw=/^[0-9A-Fa-f]{2}$/]",
    message:
      "A tint is withAlpha(theme.<role>, a), never a role with hex digits appended (mobile/DESIGN.md §1).",
  },
  {
    selector:
      "Property[key.name=/^(minHeight|minWidth)$/] > Literal[raw=/^(32|36|40|44|48)$/]",
    message:
      "A control's size is a step of controlSize (sm 32, md 40, lg 48); a smaller thing reaches 48 with hitSlop (mobile/DESIGN.md §1).",
  },
  {
    selector: `Property[key.name=/${SPACING_PROPS}/] > Literal[value!=0][raw=/^[0-9.]+$/], Property[key.name=/${SPACING_PROPS}/] > UnaryExpression > Literal`,
    message:
      "Space is a step of the scale: spacing(0.5), spacing(1), … (shared/src/designTokens.ts SPACE). A raw number, a negative or an off-scale fraction leaves it.",
  },
  {
    selector:
      "CallExpression[callee.name='emitToast'] MemberExpression[property.name='message'][object.name=/^(err|error|e|ex)$/], JSXExpressionContainer > MemberExpression[property.name='message'][object.name=/^(err|error|e|ex)$/]",
    message:
      "An error's message can carry a place name or a file name. Show words we wrote (shared/DESIGN.md §11, messageFromError from @logjam/shared), never err.message.",
  },
];

// A colour is a role from `theme`, or `withAlpha(token, a)` for a tint
// (mobile/DESIGN.md §1). Colours drawn ON the map belong to the basemap, not
// the scheme, and are `MAP_INK` (shared/DESIGN.md §15).
const COLOUR_LITERALS = [
  {
    selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
    message:
      "A screen names a colour role from theme.ts, never a hex. A colour drawn on the map is MAP_INK (shared/src/designTokens.ts).",
  },
  {
    selector: "Literal[value=/^rgba?\\(/]",
    message:
      "A tint is withAlpha(theme.<role>, a), never an rgba() string (mobile/DESIGN.md §1).",
  },
];

// The scheme is state, so nothing may hold a colour from before it changed
// (mobile/DESIGN.md §1). Module constants would freeze colours in the scheme
// the app started in. A colour is reachable only through a hook, which
// `rules-of-hooks` already keeps out of module scope.
// Guard: src/liveTheme.test.ts.
const LAUNCH_THEME_IMPORTS = [
  "error",
  {
    patterns: [
      {
        regex: "^(\\./|(\\.\\./)+)(src/)?theme$",
        importNames: [
          "theme",
          "textRole",
          "assetHue",
          "placeHue",
          "notificationHue",
          "themeMode",
          "activeThemeSchemeId",
        ],
        message:
          "A colour held at module scope does not repaint when the scheme changes. Use useTheme(), makeStyles((theme, textRole) => …) or useHues() (mobile/DESIGN.md §1).",
      },
    ],
  },
];

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["android/**", "ios/**", ".expo/**", "node_modules/**"],
  },
  {
    // One idea, one icon (DESIGN.md, shared/src/icons.ts): a screen renders
    // `<Icon idea="…" />` from the kit and never names a glyph family. Only the
    // kit's Icon, and the place-type helper that resolves a user-picked key,
    // may reach into the icon fonts.
    files: ["src/**/*.{ts,tsx}", "App.tsx"],
    ignores: ["src/ui/Icon.tsx", "src/places/placeTypeIcon.ts", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@expo/vector-icons", "@expo/vector-icons/*"],
              message:
                "Draw icons with <Icon idea=…> from src/ui — add the idea to shared/src/icons.ts if it is missing.",
            },
            {
              // `profileSeries` is pure maths a node test imports; the barrel
              // would drag react-native in with it.
              group: ["**/ui/*", "!**/ui/profileSeries"],
              message:
                'Import the kit through its barrel: from "../ui", never a file inside it (mobile/DESIGN.md §7).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "App.tsx"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...GPS_GOTCHAS,
        FONT_RULE,
        MAP_LABEL_TEXT,
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}", "src/theme.ts", "src/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...GPS_GOTCHAS,
        FONT_RULE,
        MAP_LABEL_TEXT,
        ...COLOUR_LITERALS,
      ],
    },
  },
  {
    // Where a size, weight and line height are written: the type roles.
    files: ["src/theme.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...GPS_GOTCHAS, MAP_LABEL_TEXT],
    },
  },
  {
    // The one place a map label layer's font and size live; the roles' sizes
    // do not apply to MapLibre's symbol layers.
    files: ["src/map/mapLabelText.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...GPS_GOTCHAS,
        FONT_RULE,
        ...COLOUR_LITERALS,
      ],
    },
  },
  {
    // `no-restricted-imports` under a second name, so this ban has its own
    // severity and does not replace the icon and kit-barrel bans above.
    files: ["src/**/*.{ts,tsx}", "App.tsx", "index.ts"],
    plugins: {
      logjam: {
        rules: { "no-launch-theme": builtinRules.get("no-restricted-imports") },
      },
    },
    rules: { "logjam/no-launch-theme": LAUNCH_THEME_IMPORTS },
  },
  {
    // Build-time scripts run in node, not in the app: they legitimately use
    // Buffer, process and friends, which the Expo config does not declare.
    files: ["scripts/**/*.mjs", "plugins/**/*.js"],
    languageOptions: { globals: globals.node },
  },
]);
