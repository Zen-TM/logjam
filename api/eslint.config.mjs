import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "prisma/migrations"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-control-regex": "off",
      "no-fallthrough": ["error", { allowEmptyCase: true }],
      "no-irregular-whitespace": [
        "error",
        {
          skipStrings: true,
          skipTemplates: true,
          skipComments: true,
          skipRegExps: true,
        },
      ],
      "no-unexpected-multiline": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
