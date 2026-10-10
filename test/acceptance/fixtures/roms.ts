// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Synthetic 16 KiB ROM images, one per data layout. Only the locations the
// library reads are filled in, with values chosen for these tests; nothing is
// taken from a real firmware image. Real ROM dumps must not be committed:
// they are copyright of their original authors.
//
// Each fixture carries its expected readings as literals, worked out by hand
// from docs/test-specification.md §5.8–5.10 and §5.14, so the tests do not
// rely on the library to compute their own answers.
import { DataOffsetRev, DataSize } from '@kb1rma/libcomm14cux-ts';

const ROM_BASE = 0xc000;

/** A data layout the library can detect. */
type Layout = Exclude<DataOffsetRev, typeof DataOffsetRev.Unset>;

/** Where each layout keeps fuel maps 1 to 5 (map 0 is always at 0xC000). */
const MAP_OFFSETS: Record<Layout, readonly number[]> = {
  [DataOffsetRev.RevA]: [0xc23f, 0xc351, 0xc463, 0xc575, 0xc687],
  [DataOffsetRev.RevB]: [0xc23f, 0xc351, 0xc463, 0xc575, 0xc687],
  [DataOffsetRev.RevC]: [0xc267, 0xc379, 0xc48b, 0xc59d, 0xc6af],
};

/**
 * RPM at each fuel map column boundary, column 0 first. Each one divides
 * 7,500,000 exactly, so the stored pulse width is a whole number.
 */
const RPM_COLUMN_BOUNDARIES = [
  500, 600, 750, 1000, 1200, 1250, 1500, 2000, 2400, 2500, 3000, 3750, 4000,
  5000, 6000, 7500,
];

/** A ROM image and what the library should read from it. */
export interface RomFixture {
  /** Short name used in test titles. */
  name: string;
  /** The 0x4000-byte image for 0xC000 to 0xFFFF. */
  image: Uint8Array;
  /** The data layout `getFuelMap` should detect. */
  layout: Layout;
  /** Expected `getTuneRevision()`. */
  tuneRevision: {
    tuneNumber: number;
    checksumFixer: number;
    tuneIdent: number;
  };
  /**
   * A main-voltage reading to plant at 0x0055 and the voltage it means
   * with this ROM's coefficients. Each raw value inverts to an ADC count
   * between 172.0 and 172.2, which truncates to 172 as in libcomm14cux, so
   * 0.07 × 172 − 0.09 = 11.95 V.
   */
  battery: { raw: number; volts: number };
  /** Expected `getRpmTable()`: column 0 is last, as in libcomm14cux. */
  rpmTable: number[];
}

/**
 * The value of each cell in a synthetic fuel map. Distinct per map, row and
 * column, and never above 0x30 so row 0 of map 1 cannot be mistaken for a
 * Rev C layout (§5.8).
 *
 * @param map - Fuel map id, 0 to 5.
 * @param row - Row, 0 to 7.
 * @param column - Column, 0 to 15.
 * @returns The cell value.
 */
export function fuelMapCell(map: number, row: number, column: number): number {
  return 0x10 + ((map * 5 + row * 3 + column) % 0x20);
}

/**
 * The adjustment factor stored after each synthetic fuel map.
 *
 * @param map - Fuel map id, 0 to 5.
 * @returns The 16-bit factor.
 */
export function fuelMapAdjustment(map: number): number {
  return 0x7000 + map * 0x111;
}

/**
 * The row scaler stored for each synthetic fuel map.
 *
 * @param map - Fuel map id, 0 to 5.
 * @returns The scaler byte.
 */
export function fuelMapRowScaler(map: number): number {
  return 0x80 + map;
}

interface RomSpec {
  name: string;
  layout: Layout;
  tuneBcd: [number, number];
  checksumFixer: number;
  tuneIdent: number;
  /** Main-voltage coefficients stored in the ROM (Rev B and C only). */
  coefficients?: { a: number; b: number; c: number };
  battery: { raw: number; volts: number };
  tuneRevision: RomFixture['tuneRevision'];
}

function buildRom(spec: RomSpec): RomFixture {
  const image = new Uint8Array(DataSize.ROM).fill(0xff);

  const put = (address: number, ...bytes: number[]) => {
    image.set(bytes, address - ROM_BASE);
  };

  const putWord = (address: number, value: number) => {
    put(address, value >> 8, value & 0xff);
  };

  const mapOffsets = [0xc000, ...MAP_OFFSETS[spec.layout]];

  mapOffsets.forEach((offset, map) => {
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 16; column++) {
        put(offset + row * 16 + column, fuelMapCell(map, row, column));
      }
    }

    putWord(offset + 0x80, fuelMapAdjustment(map));
    put(map === 0 ? 0xc1c9 : offset + 0x10a, fuelMapRowScaler(map));
  });

  if (spec.layout === DataOffsetRev.RevC) {
    // Calibration data that sits where older layouts keep map 1.
    put(0xc23f, 0x5a, 0xa5, 0x31, 0x99);
  }

  if (spec.coefficients) {
    const { a, b, c } = spec.coefficients;
    const base = spec.layout === DataOffsetRev.RevC ? 0xc7c3 : 0xc79b;

    put(base, a, b);
    putWord(base + 2, c);
  } else {
    // Rev A: 0xFF where Rev B keeps coefficient A.
    put(0xc79b, 0xff);
  }

  RPM_COLUMN_BOUNDARIES.forEach((rpm, column) => {
    putWord(0xc800 + column * 4, 7_500_000 / rpm);
  });

  put(
    0xffe9,
    ...spec.tuneBcd,
    spec.checksumFixer,
    spec.tuneIdent >> 8,
    spec.tuneIdent & 0xff,
  );

  return {
    name: spec.name,
    image,
    layout: spec.layout,
    tuneRevision: spec.tuneRevision,
    battery: spec.battery,
    rpmTable: [...RPM_COLUMN_BOUNDARIES].reverse(),
  };
}

/** An early ROM with fixed main-voltage coefficients (§5.9). */
export const revARom = buildRom({
  name: 'Rev A',
  layout: DataOffsetRev.RevA,
  tuneBcd: [0x29, 0x67],
  checksumFixer: 0x3c,
  tuneIdent: 0x0055,
  // Fixed coefficients A=0x64, B=0xBD, C=0x6180.
  battery: { raw: 0x03e8, volts: 11.95 },
  tuneRevision: { tuneNumber: 2967, checksumFixer: 0x3c, tuneIdent: 0x0055 },
});

/** A ROM with the old map layout and coefficients at 0xC79B. */
export const revBRom = buildRom({
  name: 'Rev B',
  layout: DataOffsetRev.RevB,
  tuneBcd: [0x31, 0x16],
  checksumFixer: 0x81,
  tuneIdent: 0x0102,
  coefficients: { a: 0x60, b: 0xc0, c: 0x6000 },
  battery: { raw: 0x0294, volts: 11.95 },
  tuneRevision: { tuneNumber: 3116, checksumFixer: 0x81, tuneIdent: 0x0102 },
});

/** A ROM with the new map layout and coefficients at 0xC7C3. */
export const revCRom = buildRom({
  name: 'Rev C',
  layout: DataOffsetRev.RevC,
  tuneBcd: [0x33, 0x60],
  checksumFixer: 0xe4,
  tuneIdent: 0x0b0e,
  coefficients: { a: 0x5c, b: 0xc4, c: 0x5e00 },
  battery: { raw: 0x00f4, volts: 11.95 },
  tuneRevision: { tuneNumber: 3360, checksumFixer: 0xe4, tuneIdent: 0x0b0e },
});

/** Every ROM fixture, for `describe.each`. */
export const allRoms: readonly RomFixture[] = [revARom, revBRom, revCRom];
