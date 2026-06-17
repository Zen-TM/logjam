import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
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
