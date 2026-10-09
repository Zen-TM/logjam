import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

const MUI_PATTERNS = [
  {
    group: ["@mui/*", "@emotion/*"],
    message:
      "Logjam Web builds on its own kit — import from src/ui (frontend/DESIGN.md).",
  },
];

export default tseslint.config(
  { ignores: ["dist"] },
  {
    // MUI is gone from Logjam Web (Phase C, 2026-09-19) and the packages are
    // uninstalled, so this rule now guards a decision rather than a migration:
    // it turns "we removed that" into an error at the import rather than a
    // module-not-found three minutes later, and it names what to reach for
    // instead. There is no exception list any more.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message:
                "Draw icons with <Icon idea=…> from src/ui — add the idea to shared/src/icons.ts if it is missing.",
            },
          ],
          patterns: MUI_PATTERNS,
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
      "no-restricted-imports": ["error", { patterns: MUI_PATTERNS }],
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
