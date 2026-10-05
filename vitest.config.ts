// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude],
    reporters: process.env['GITHUB_ACTIONS']
      ? ['default', 'github-actions', 'junit']
      : ['default', 'junit'],
    outputFile: {
      junit: './test-reports/junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-support/**', 'src/**/types.ts'],
      // Near-full coverage is a project requirement. Branches are held
      // slightly lower to allow for defensive guards that TypeScript's
      // strictness makes unreachable.
      thresholds: {
        statements: 98,
        lines: 98,
        functions: 100,
        branches: 95,
      },
    },
  },
});
