import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

const LUCIDE_PATH = {
  name: "lucide-react",
  message:
    "Draw icons with <Icon idea=…> from src/ui — add the idea to shared/src/icons.ts if it is missing.",
};

// An error's message can carry a place name (the third selector below).
const ERROR_MESSAGE =
  "MemberExpression[property.name='message'][object.name=/^(err|error|e|ex)$/]";
const ERROR_MESSAGE_MSG =
  "An error's message can carry a place name. Show messageFromError(err, \"Couldn't save place.\") through ErrorBanner, FieldError or useToast().error (frontend/DESIGN.md §3).";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    // Logjam Web draws icons through its own kit, never Lucide directly.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [LUCIDE_PATH],
        },
      ],
    },
  },
  {
    // The only files that may name a Lucide glyph: the kit's Icon and its
    // registry map, and the two resolvers for the USER-PICKED vocabularies
    // (a place type's and a trip type's icon). Everything else renders
    // `<Icon idea=…>`.
    files: [
      "src/ui/Icon.tsx",
      "src/ui/webIcons.ts",
      "src/components/sidebar/panels/placeTypeIcon.tsx",
      "src/components/sidebar/panels/tripTypeIcon.ts",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    // A panel gets callbacks from App.tsx and never reaches into the map
    // (frontend/AGENTS.md, UI). It repeats the base rule's lucide entry because
    // a later block replaces the rule, not merges it. The two icon resolvers
    // are in the lucide allow-list above, not panels.
    files: [
      "src/components/**/*Panel.tsx",
      "src/components/sidebar/panels/**/*.{ts,tsx}",
    ],
    ignores: [
      "src/**/*.test.{ts,tsx}",
      "src/components/sidebar/panels/placeTypeIcon.tsx",
      "src/components/sidebar/panels/tripTypeIcon.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [LUCIDE_PATH],
          patterns: [
            {
              group: ["**/map/Map", "./Map"],
              message:
                "A panel never imports from Map.tsx: App.tsx hands it callbacks. A type the panel needs belongs in @logjam/shared or its own file (frontend/AGENTS.md, UI).",
            },
          ],
        },
      ],
    },
  },
  {
    // Gotchas of Logjam Web that a selector can hold (frontend/DESIGN.md §3).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXElement[openingElement.name.name='Dialog'] JSXAttribute[name.name='autoFocus']",
          message:
            "autoFocus fires before a dialog is shown, when nothing in it can take focus. Mark the first control data-autofocus and Dialog focuses it (frontend/DESIGN.md §3).",
        },
        {
          selector:
            "JSXAttribute[name.name='style'] Property[key.name=/^(color|background|backgroundColor|borderColor|outlineColor|fill|stroke)$/]",
          message:
            'A colour is a role (--color-<role>), or a hue the kit reads through a custom property (style={{ "--tile-hue": hue }}). Never set one inline (frontend/DESIGN.md §1).',
        },
        // Rendered as a child, an attribute (also inside a template literal),
        // a toast's text, or a setXxxError call.
        ...[
          `JSXElement > JSXExpressionContainer ${ERROR_MESSAGE}`,
          `JSXAttribute > JSXExpressionContainer > ${ERROR_MESSAGE}`,
          `JSXAttribute > JSXExpressionContainer > TemplateLiteral ${ERROR_MESSAGE}`,
          `CallExpression[callee.object.name=/^(toast|api)$/][callee.property.name=/^(error|success|done|info)$/] ${ERROR_MESSAGE}`,
          `CallExpression[callee.name=/^set\\w*Error$/] ${ERROR_MESSAGE}`,
        ].map((selector) => ({ selector, message: ERROR_MESSAGE_MSG })),
      ],
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Crashes under ESLint 9 + minimatch v10 (plugin uses the removed default
      // export). Our inputs are labelled via aria-label, so we lose little here.
      "jsx-a11y/label-has-associated-control": "off",
      // autoFocus is used deliberately to focus the first field of just-opened
      // auth screens / modal dialogs, where moving focus in is expected.
      "jsx-a11y/no-autofocus": "off",
      // Trip media is user-uploaded with no authored audio track, so captions
      // (1.2.2) don't apply; we can't generate them.
      "jsx-a11y/media-has-caption": "off",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
