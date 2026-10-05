// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.10 (fuel map decoding)
import { DataOffsetRev } from '../constants.js';
import { InvalidReadingError } from '../errors.js';
import {
  decodeCurrentFuelMap,
  decodeFuelMapColumnIndex,
  decodeFuelMapRowIndex,
  decodeRpmTableEntry,
  assertFuelMapId,
  fuelMapLocation,
  rpmTableEntryAddress,
  rpmTableSlot,
} from './fuelMap.js';

describe('fuelMapLocation', () => {
  it.each([DataOffsetRev.RevA, DataOffsetRev.RevB, DataOffsetRev.RevC])(
    'places Map 0 at 0xC000 with scaler 0xC1C9 for revision %i',
    (rev) => {
      expect(fuelMapLocation(0, rev)).toEqual({
        offset: 0xc000,
        scalerOffset: 0xc1c9,
      });
    },
  );

  it.each([
    [1, 0xc23f],
    [2, 0xc351],
    [3, 0xc463],
    [4, 0xc575],
    [5, 0xc687],
  ])('places old-layout map %i at 0x%x', (id, offset) => {
    for (const rev of [DataOffsetRev.RevA, DataOffsetRev.RevB]) {
      expect(fuelMapLocation(id, rev)).toEqual({
        offset,
        scalerOffset: offset + 0x10a,
      });
    }
  });

  it.each([
    [1, 0xc267],
    [2, 0xc379],
    [3, 0xc48b],
    [4, 0xc59d],
    [5, 0xc6af],
  ])('places Rev C map %i at 0x%x', (id, offset) => {
    expect(fuelMapLocation(id, DataOffsetRev.RevC)).toEqual({
      offset,
      scalerOffset: offset + 0x10a,
    });
  });
});

describe('assertFuelMapId', () => {
  it.each([0, 1, 5])('accepts %i', (id) => {
    expect(() => assertFuelMapId(id)).not.toThrow();
  });

  it.each([-1, 6, 1.5, Number.NaN])('rejects %d', (id) => {
    expect(() => assertFuelMapId(id)).toThrow(RangeError);
  });
});

describe('current fuel map', () => {
  it.each([0, 3, 5])('accepts %i', (id) => {
    expect(decodeCurrentFuelMap(id)).toBe(id);
  });

  it.each([6, 0xff])('rejects %i', (id) => {
    expect(() => decodeCurrentFuelMap(id)).toThrow(InvalidReadingError);
  });
});

describe('fuel map indexes', () => {
  it('splits the row byte into index (high nibble) and weighting (low)', () => {
    expect(decodeFuelMapRowIndex(0x7a)).toEqual({ index: 7, weighting: 10 });
    expect(decodeFuelMapRowIndex(0x00)).toEqual({ index: 0, weighting: 0 });
  });

  it.each([0x80, 0xff])('rejects row byte 0x%x', (byte) => {
    expect(() => decodeFuelMapRowIndex(byte)).toThrow(InvalidReadingError);
  });

  it('splits the column byte the same way and accepts 0..15', () => {
    expect(decodeFuelMapColumnIndex(0xf3)).toEqual({ index: 15, weighting: 3 });
    expect(decodeFuelMapColumnIndex(0x00)).toEqual({ index: 0, weighting: 0 });
  });
});

describe('RPM table helpers', () => {
  it('addresses column n at 0xC800 + n * 4', () => {
    expect(rpmTableEntryAddress(0)).toBe(0xc800);
    expect(rpmTableEntryAddress(15)).toBe(0xc800 + 60);
  });

  it('stores column 0 in the last slot and column 15 in the first', () => {
    expect(rpmTableSlot(0)).toBe(15);
    expect(rpmTableSlot(15)).toBe(0);
  });

  it('converts entries with the pulse-width formula', () => {
    expect(decodeRpmTableEntry(7500)).toBe(1000);
    expect(() => decodeRpmTableEntry(0)).toThrow(InvalidReadingError);
  });
});
