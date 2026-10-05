// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.9 (c14cux_getMainVoltage)
import { RevAMainVoltageFactor } from '../constants.js';
import { InvalidReadingError } from '../errors.js';
import { decodeMainVoltage } from './mainVoltage.js';

const { A, B, C } = RevAMainVoltageFactor;

describe('main voltage decoding', () => {
  // Golden values computed with libcomm14cux's formula (data.c):
  //   adc = -(16 * (sqrt(4Ay - AC + 64B^2) - 8B)) / A, truncated
  //   volts = 0.07 * adc - 0.09
  it.each([
    [899, 180, 12.51],
    [2492, 99, 6.84],
    [3000, 82, 5.65],
  ])(
    'stored %i -> ADC %i -> %d V (Rev A coefficients)',
    (stored, _adc, volts) => {
      expect(decodeMainVoltage(stored, A, B, C)).toBeCloseTo(volts, 5);
    },
  );

  it('works with Rev B/C style coefficients', () => {
    // x = 180 with A=100, B=189, C=24960 is the same as Rev A.
    expect(decodeMainVoltage(899, 100, 189, 24960)).toBeCloseTo(12.51, 5);
  });

  it('rejects a reading that gives a negative discriminant instead of returning NaN', () => {
    expect(() => decodeMainVoltage(0, A, B, 0xffff)).toThrow(
      InvalidReadingError,
    );
  });
});
