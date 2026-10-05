// SPDX-License-Identifier: GPL-3.0-only
// Derived from libcomm14cux (https://github.com/colinbourassa/libcomm14cux)
// Copyright (C) Colin Bourassa. Licensed under the GNU GPL v3.
// Ported to TypeScript and modified for comm14cux-ts, 2026.

// Spec: §5.1 (temperature_adc_to_degrees_f)
import { InvalidReadingError } from '../errors.js';
import {
  TEMPERATURE_ADC_TO_DEGREES_F,
  decodeTemperatureF,
} from './temperature.js';

describe('temperature decoding', () => {
  it('has exactly 256 entries', () => {
    expect(TEMPERATURE_ADC_TO_DEGREES_F).toHaveLength(256);
  });

  it.each([
    [0, 266],
    [1, 264],
    [127, 82],
    [128, 82],
    [200, 29],
    [254, -13],
    [255, -13],
  ])('maps ADC count %i to %i °F', (count, degrees) => {
    expect(decodeTemperatureF(count)).toBe(degrees);
  });

  it('is monotonically non-increasing', () => {
    for (let i = 1; i < 256; i++) {
      expect(decodeTemperatureF(i)).toBeLessThanOrEqual(
        decodeTemperatureF(i - 1),
      );
    }
  });

  it.each([-1, 256, 1.5])('rejects ADC count %d', (count) => {
    expect(() => decodeTemperatureF(count)).toThrow(InvalidReadingError);
  });
});
