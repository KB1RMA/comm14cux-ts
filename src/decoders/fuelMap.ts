// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

import {
  DataOffsetRev,
  FUEL_MAP_COLUMNS,
  FUEL_MAP_ROWS,
  FUEL_MAP_ROW_SCALER_OFFSET,
  MemoryOffset,
} from '../constants.js';
import { InvalidReadingError } from '../errors.js';
import { pulseWidthToRpm } from './engineSpeed.js';

export interface FuelMapLocation {
  /** Address of the 128-byte map; the 2-byte adjustment factor follows it. */
  offset: number;
  /** Address of the row scaler byte. */
  scalerOffset: number;
}

const OLD_MAPS = [
  MemoryOffset.OldFuelMap1,
  MemoryOffset.OldFuelMap2,
  MemoryOffset.OldFuelMap3,
  MemoryOffset.OldFuelMap4,
  MemoryOffset.OldFuelMap5,
];

const NEW_MAPS = [
  MemoryOffset.NewFuelMap1,
  MemoryOffset.NewFuelMap2,
  MemoryOffset.NewFuelMap3,
  MemoryOffset.NewFuelMap4,
  MemoryOffset.NewFuelMap5,
];

export type KnownDataOffsetRev = Exclude<DataOffsetRev, 0>;

/** Rejects a fuel map id outside 0..5. */
export function assertFuelMapId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 5) {
    throw new RangeError(`Invalid fuel map id: ${id}`);
  }
}

/** Where fuel map `id` (0..5) lives for the given ROM data layout. */
export function fuelMapLocation(
  id: number,
  revision: KnownDataOffsetRev,
): FuelMapLocation {
  // Map 0 is at the same place in both layouts.
  if (id === 0) {
    return {
      offset: MemoryOffset.FuelMap0,
      scalerOffset: MemoryOffset.Map0RowScalerInitValue,
    };
  }

  const maps = revision === DataOffsetRev.RevC ? NEW_MAPS : OLD_MAPS;
  const offset = maps[id - 1] ?? 0;

  return { offset, scalerOffset: offset + FUEL_MAP_ROW_SCALER_OFFSET };
}

/** The current fuel map id (0..5). */
export function decodeCurrentFuelMap(id: number): number {
  if (id > 5) {
    throw new InvalidReadingError(`Invalid fuel map id: ${id}`);
  }

  return id;
}

export interface FuelMapIndex {
  index: number;
  weighting: number;
}

function decodeIndex(byte: number, limit: number, what: string): FuelMapIndex {
  const index = byte >> 4;

  if (index >= limit) {
    throw new InvalidReadingError(`Invalid fuel map ${what} index: ${index}`);
  }

  return { index, weighting: byte & 0x0f };
}

/** High nibble is the row index, low nibble the row weighting. */
export const decodeFuelMapRowIndex = (byte: number): FuelMapIndex =>
  decodeIndex(byte, FUEL_MAP_ROWS, 'row');

/** High nibble is the column index, low nibble the column weighting. */
export const decodeFuelMapColumnIndex = (byte: number): FuelMapIndex =>
  decodeIndex(byte, FUEL_MAP_COLUMNS, 'column');

/** Address of column `column`'s pulse width in the RPM table. */
export const rpmTableEntryAddress = (column: number): number =>
  MemoryOffset.RPMTable + column * 4;

/** Slot in the RPM table result for the pulse width read for `column`. */
export const rpmTableSlot = (column: number): number =>
  FUEL_MAP_COLUMNS - column - 1;

/** Converts one RPM table pulse width to RPM. */
export const decodeRpmTableEntry = pulseWidthToRpm;
