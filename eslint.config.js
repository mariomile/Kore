import { defineESLintConfig } from '@ocavue/eslint-config'

export default defineESLintConfig(
  {
    react: {
      version: '19.2',
      reactCompiler: true,
      files: ['**/*.tsx', './apps/desktop/src/**/*.ts'],
    },
    markdown: false,
    packageJson: false,
    command: true,
    perfectionist: false,
  },
  {
    // src-tauri/gen holds generated platform projects plus Apple's Share
    // Extension preprocessing JS — not code this repo authors or lints.
    ignores: ['./design-system/', '**/.wxt/', '**/.output/', '**/src-tauri/gen/'],
  },
  {
    // The AI SDK loads on first use (packages/core/src/ai/load-sdk.ts). A value
    // import of it anywhere else puts ~550 KB back into the startup bundle;
    // type imports and `await import()` are fine.
    files: ['apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'packages/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/testing/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'ai',
              allowTypeImports: true,
              message: 'Load the AI SDK on first use with loadAiSdk() from ai/load-sdk.',
            },
          ],
          patterns: [
            {
              group: ['@ai-sdk/*'],
              allowTypeImports: true,
              message: 'Load AI provider packages on first use with await import().',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs'],
    // Disable some rules temporarily
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    /// keep-sorted
    rules: {
      '@eslint-react/dom-no-flush-sync': 'off',
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/naming-convention-ref-name': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/use-state': 'off',
      '@eslint-react/web-api-no-leaked-event-listener': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      'jsdoc/multiline-blocks': 'off',
      'jsdoc/no-multi-asterisks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/globals': 'off',
      'regexp/no-super-linear-backtracking': 'off',
      'unicorn/no-computed-property-existence-check': 'off',
      'unicorn/no-optional-chaining-on-undeclared-variable': 'off',
      'unicorn/no-unnecessary-splice': 'off',
    },
  },
)
