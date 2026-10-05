// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Major/minor/patch version of this library (`c14cux_version`). */
export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** Must match `version` in package.json (enforced by a test). */
export const LIBRARY_VERSION: Version = { major: 0, minor: 0, patch: 0 };
