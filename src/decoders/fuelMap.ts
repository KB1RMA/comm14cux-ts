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

/**
 * Where a fuel map lives in ECU memory.
 */
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

/**
 * A {@link DataOffsetRev} that has been determined (not `Unset`).
 */
export type KnownDataOffsetRev = Exclude<DataOffsetRev, 0>;

/**
 * Rejects a fuel map id outside 0 to 5.
 *
 * @param id - The fuel map id to check.
 * @throws {@link RangeError} if `id` is not an integer from 0 to 5.
 */
export function assertFuelMapId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 5) {
    throw new RangeError(`Invalid fuel map id: ${id}`);
  }
}

/**
 * Finds where a fuel map lives for the given ROM data layout.
 *
 * @param id - Map id, 0 to 5 (checked by {@link assertFuelMapId}).
 * @param revision - The ROM's data layout.
 * @returns The map's address and its row scaler's address.
 */
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

/**
 * Validates the current fuel map id.
 *
 * @param id - The byte read from 0x202C.
 * @returns The map id, 0 to 5.
 * @throws {@link InvalidReadingError} if `id` is above 5.
 */
export function decodeCurrentFuelMap(id: number): number {
  if (id > 5) {
    throw new InvalidReadingError(`Invalid fuel map id: ${id}`);
  }

  return id;
}

/**
 * A position within the fuel map and its interpolation weighting.
 */
export interface FuelMapIndex {
  /**
   * The row or column index.
   */
  index: number;
  /**
   * The weighting (0 to 15) used to interpolate toward the next row or column.
   */
  weighting: number;
}

function decodeIndex(byte: number, limit: number, what: string): FuelMapIndex {
  const index = byte >> 4;

  if (index >= limit) {
    throw new InvalidReadingError(`Invalid fuel map ${what} index: ${index}`);
  }

  return { index, weighting: byte & 0x0f };
}

/**
 * Decodes the row index byte: the high nibble is the row, the low nibble the
 * weighting.
 *
 * @param byte - The byte read from 0x005B.
 * @returns The row index (0 to 7) and weighting.
 * @throws {@link InvalidReadingError} if the row index is 8 or more.
 */
export const decodeFuelMapRowIndex = (byte: number): FuelMapIndex =>
  decodeIndex(byte, FUEL_MAP_ROWS, 'row');

/**
 * Decodes the column index byte: the high nibble is the column, the low nibble
 * the weighting.
 *
 * @param byte - The byte read from 0x005C.
 * @returns The column index (0 to 15) and weighting.
 * @throws {@link InvalidReadingError} if the column index is 16 or more.
 */
export const decodeFuelMapColumnIndex = (byte: number): FuelMapIndex =>
  decodeIndex(byte, FUEL_MAP_COLUMNS, 'column');

/**
 * Gives the address of one entry in the RPM table.
 *
 * @param column - Fuel map column, 0 to 15.
 * @returns The address of the column's two-byte pulse width.
 */
export const rpmTableEntryAddress = (column: number): number =>
  MemoryOffset.RPMTable + column * 4;

/**
 * Gives the slot in the result array for an RPM table column. The C library
 * stores column 0 last.
 *
 * @param column - Fuel map column, 0 to 15.
 * @returns The index in the result array.
 */
export const rpmTableSlot = (column: number): number =>
  FUEL_MAP_COLUMNS - column - 1;

/**
 * Converts one RPM table pulse width to RPM; see {@link pulseWidthToRpm}.
 */
export const decodeRpmTableEntry = pulseWidthToRpm;
