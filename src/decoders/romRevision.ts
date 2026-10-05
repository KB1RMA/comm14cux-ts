// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import { DataOffsetRev } from '../constants.js';

/**
 * Tells whether the ROM uses the Rev C data layout. The first row of a fuel
 * map never reaches 0x30, so a larger value at the old Map 1 location means it
 * is not map data.
 *
 * @param oldMap1FirstRow - The 16 bytes read from 0xC23F.
 * @returns `true` for the Rev C layout.
 */
export function isRevC(oldMap1FirstRow: Uint8Array): boolean {
  return oldMap1FirstRow.some((value) => value > 0x30);
}

/**
 * Distinguishes Rev A from Rev B by the first main voltage factor byte.
 *
 * @param voltageFactorA - The byte read from 0xC79B.
 * @returns Rev A if it is 0xFF, otherwise Rev B.
 */
export function classifyOldRevision(
  voltageFactorA: number,
): typeof DataOffsetRev.RevA | typeof DataOffsetRev.RevB {
  return voltageFactorA === 0xff ? DataOffsetRev.RevA : DataOffsetRev.RevB;
}
