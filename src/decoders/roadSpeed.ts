// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

/**
 * Converts the road speed byte to miles per hour.
 *
 * @param kph - The byte read from 0x2003, in kilometres per hour.
 * @returns Speed in whole miles per hour, truncated.
 */
export function decodeRoadSpeedMph(kph: number): number {
  return Math.trunc(kph * 0.621371192);
}
