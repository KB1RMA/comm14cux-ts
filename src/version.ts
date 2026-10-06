// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 comm14cux-ts contributors

/** Major/minor/patch version of this library (`c14cux_version`). */
export interface Version {
  /**
   * Major version number.
   */
  major: number;
  /**
   * Minor version number.
   */
  minor: number;
  /**
   * Patch version number.
   */
  patch: number;
}

/** Updated by release-please; must match `version` in package.json (enforced by a test). */
const PACKAGE_VERSION = '0.0.0'; // x-release-please-version

const [major = 0, minor = 0, patch = 0] =
  PACKAGE_VERSION.split('.').map(Number);

export /**
 *
 */
const LIBRARY_VERSION: Version = { major, minor, patch };
