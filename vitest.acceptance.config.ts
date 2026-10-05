// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// The acceptance suite imports the library by its package name. By default
// that resolves to the TypeScript sources; with ACCEPTANCE_TARGET=dist it
// resolves to the built output, so a release is tested as it will ship.
const target =
  process.env['ACCEPTANCE_TARGET'] === 'dist'
    ? './dist/index.js'
    : './src/index.ts';

export default defineConfig({
  resolve: {
    alias: {
      'comm14cux-ts': fileURLToPath(new URL(target, import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/acceptance/**/*.acceptance.test.ts'],
    exclude: [...configDefaults.exclude],
    reporters: process.env['GITHUB_ACTIONS']
      ? ['default', 'github-actions', 'junit']
      : ['default', 'junit'],
    outputFile: {
      junit: './test-reports/acceptance-junit.xml',
    },
  },
});
