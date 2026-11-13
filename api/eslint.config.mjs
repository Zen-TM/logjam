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
      // Log through lib/logger.ts, never console (api/AGENTS.md); the files
      // under the override below are the only exceptions.
      "no-console": "error",
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
  {
    // Each of these runs before lib/logger.ts can load (it calls getEnv()), or
    // reports getEnv's own failure, so the logger is not available to it.
    files: ["src/boot.ts", "src/lib/env.ts", "src/lib/resolveSmtpPassword.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Command-line scripts and test helpers print to a terminal; the rule is
    // about the running API, whose output is the structured log.
    files: ["prisma/**", "src/__tests__/**"],
    rules: { "no-console": "off" },
  },
);
