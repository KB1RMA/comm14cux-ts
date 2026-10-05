// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

// The acceptance suite imports the library by its package name. By default
// that is aliased to the TypeScript sources. With ACCEPTANCE_TARGET=dist there
// is no alias: the name resolves through package.json "exports" to the built
// output, so a release is tested as it will ship, entry points included.
const testDist = process.env['ACCEPTANCE_TARGET'] === 'dist';

export default defineConfig({
  resolve: {
    alias: testDist
      ? {}
      : {
          'comm14cux-ts': fileURLToPath(
            new URL('./src/index.ts', import.meta.url),
          ),
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
