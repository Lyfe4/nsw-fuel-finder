import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import importX from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Import ordering is shared by every file type, so it lives in one place.
const importOrderRule = [
  'error',
  {
    groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
    // `@/...` is our own source, not a third-party scoped package.
    pathGroups: [{ pattern: '@/**', group: 'internal' }],
    pathGroupsExcludedImportTypes: ['builtin'],
    'newlines-between': 'always',
    alphabetize: { order: 'asc', caseInsensitive: true },
  },
];

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', '.netlify'],
  },

  {
    // An `eslint-disable` comment that no longer suppresses anything is an
    // error. Stops stale suppressions from accumulating in the repo.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  // --- Baseline for every linted file ---------------------------------------
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended],
    plugins: { 'import-x': importX },
    rules: {
      'import-x/order': importOrderRule,
      'import-x/first': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/newline-after-import': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // A file this long is doing more than one job. Split it before it
      // becomes the component everything else has to route through.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },

  // --- TypeScript, with type-aware rules -------------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      // `projectService` asks TypeScript itself which project a file belongs to,
      // instead of us hand-maintaining a list of tsconfigs here.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.browser,
    },
    rules: {
      // All three are already on via strictTypeChecked; restated so their
      // removal has to be deliberate.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',

      // Pairs with `verbatimModuleSyntax`: anything used only as a type must be
      // imported with `import type`, so it is guaranteed to vanish at build time.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Allow `void someAsyncCall()` as the explicit "I am not awaiting this" marker.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],

      // --- No code from strings, no HTML from strings ---------------------
      // Station names and addresses come from a third-party API. They are
      // data, and must only ever reach the page as text.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message: 'Assigning innerHTML injects markup. Render through React instead.',
        },
        {
          property: 'outerHTML',
          message: 'Assigning outerHTML injects markup. Render through React instead.',
        },
        {
          property: 'insertAdjacentHTML',
          message: 'insertAdjacentHTML injects markup. Render through React instead.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML defeats React escaping. Render the value as text.',
        },
        /*
         * DEFERRED FOCUS (carried over from Patchbay, where it caused five
         * separate bugs). A focus move deferred to a requestAnimationFrame, a
         * setTimeout or a useEffect lands in the middle of whatever the user
         * did next and silently takes focus off it. useLayoutEffect runs
         * inside the task that asked for the move, so there is no window.
         */
        {
          selector:
            ":matches(CallExpression[callee.name='requestAnimationFrame'], CallExpression[callee.property.name='requestAnimationFrame'], CallExpression[callee.name='setTimeout'], CallExpression[callee.property.name='setTimeout'], CallExpression[callee.name='useEffect']) CallExpression[callee.property.name='focus']",
          message:
            'Focus moved after the task that asked for it steals focus from whatever the user did next. Use useLayoutEffect. See the note in eslint.config.js.',
        },
      ],
    },
  },

  // --- The Netlify function runs on Node, not in a browser --------------------
  {
    files: ['netlify/functions/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // --- Tests -------------------------------------------------------------------
  // Fixture-driven tests are long by nature; the size limit is for source.
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    rules: { 'max-lines': 'off' },
  },

  // --- React ------------------------------------------------------------------
  {
    files: ['**/*.tsx'],
    // `configs.flat` is the flat-config build of these presets; the top-level
    // `configs` entry is still the legacy eslintrc shape.
    extends: [reactHooks.configs.flat['recommended-latest'], jsxA11y.flatConfigs.strict],
  },

  // --- Config files that run in Node ------------------------------------------
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Must stay last: switches off every rule Prettier already handles, so the
  // formatter and the linter can never disagree about the same line.
  prettierConfig,
);
