// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import tseslint from 'typescript-eslint';
import vitestPlugin from '@vitest/eslint-plugin';
import jsdocPlugin from 'eslint-plugin-jsdoc';
import tsdocPlugin from 'eslint-plugin-tsdoc';

const paddingLines = [
  'error',
  { blankLine: 'always', prev: '*', next: 'block-like' },
  { blankLine: 'always', prev: 'block-like', next: '*' },
  { blankLine: 'always', prev: '*', next: 'return' },
];

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-reports/**',
    ],
  },
  prettierConfig,
  {
    files: ['*.{js,mjs,cjs}'],
    plugins: { prettier: prettierPlugin },
    rules: {
      'prettier/prettier': 'error',
      'padding-line-between-statements': paddingLines,
    },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', '*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      prettier: prettierPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 'latest',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'prettier/prettier': 'error',
      'padding-line-between-statements': paddingLines,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': 'allow-with-description',
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Type-aware rules: the library is async-heavy (serial I/O), so
      // dropped promises and misused async callbacks are the likeliest bugs.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
    },
  },
  {
    // Documentation rules for the library's own source (not tests).
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    plugins: { jsdoc: jsdocPlugin, tsdoc: tsdocPlugin },
    rules: {
      'tsdoc/syntax': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
          },
          contexts: [
            'TSInterfaceDeclaration',
            'TSTypeAliasDeclaration',
            'TSEnumDeclaration',
            'VariableDeclaration',
            'PropertyDefinition',
            'TSPropertySignature',
          ],
          checkConstructors: true,
        },
      ],
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/require-throws': 'error',
    },
  },
  {
    // Vitest rules for unit tests colocated under src/ and for the
    // acceptance suite and its helpers under test/.
    files: ['src/**/*.test.ts', 'test/**/*.ts'],
    plugins: { vitest: vitestPlugin },
    languageOptions: {
      globals: { ...vitestPlugin.environments.env.globals },
    },
    rules: {
      ...vitestPlugin.configs.recommended.rules,
      'vitest/expect-expect': 'error',
      'vitest/no-disabled-tests': 'warn',
      'vitest/no-focused-tests': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-have-length': 'error',
    },
  },
];
