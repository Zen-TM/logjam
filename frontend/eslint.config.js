import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'


/**
 * Files that still import MUI. Logjam Web is moving to its own kit
 * (src/ui, frontend/DESIGN.md), so MUI is an ERROR everywhere else — a new file
 * cannot reach for it. This list may only SHRINK: when a file is rebuilt on the
 * kit, delete its line. When it is empty, delete it, the rule's exception and
 * the @mui dependencies.
 */
const MUI_LEGACY_FILES = [
  'src/components/ConsentGate.tsx',
  'src/components/dialogs/AddCustomFieldDialog.tsx',
  'src/components/dialogs/ChangeEmailDialog.tsx',
  'src/components/dialogs/DeleteAccountDialog.tsx',
  'src/components/dialogs/ImportResultSummary.tsx',
  'src/components/dialogs/MatchReview.tsx',
  'src/components/dialogs/OnboardingChoiceDialog.tsx',
  'src/components/dialogs/PlaceDialog.tsx',
  'src/components/dialogs/RopeWikiReviewDialog.tsx',
  'src/components/dialogs/SelectedPlacesDialog.tsx',
  'src/components/dialogs/UnifiedImportDialog.tsx',
  'src/components/dialogs/ValidatedNumberField.tsx',
  'src/components/SignIn.tsx',
  'src/csvImport/SectionLabel.tsx',
  'src/main.tsx',
  'src/theme.ts',
]

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: MUI_LEGACY_FILES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@mui/*', '@emotion/*'],
              message: 'Logjam Web builds on its own kit — import from src/ui (frontend/DESIGN.md).',
            },
          ],
        },
      ],
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Crashes under ESLint 9 + minimatch v10 (plugin uses the removed default
      // export). Our inputs are labelled via aria-label, so we lose little here.
      'jsx-a11y/label-has-associated-control': 'off',
      // autoFocus is used deliberately to focus the first field of just-opened
      // auth screens / modal dialogs, where moving focus in is expected.
      'jsx-a11y/no-autofocus': 'off',
      // Trip media is user-uploaded with no authored audio track, so captions
      // (1.2.2) don't apply; we can't generate them.
      'jsx-a11y/media-has-caption': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
